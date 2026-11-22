import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { useLanguage } from '../contexts/LanguageContext';
import {
  formatMoney,
  roundTo2,
  calculateChangeDue,
  calculatePointsEarned,
  calculateBillFinancials,
} from '../engine/calculations';
import { getImageDoc, subscribeCollection, payBillAtomic } from '../data/db';
import {
  X,
  Banknote,
  QrCode,
  CreditCard,
  Plus,
  Trash2,
  Star,
  Printer,
  FileText,
  AlertTriangle,
  Delete,
  Check,
  Wallet,
} from 'lucide-react';
import { NumericInput } from '../costing/components/common/NumericInput';
import { ReceiptModal } from './ReceiptModal';

interface Props {
  bill: BillDoc;
  settings: SettingsDoc;
  lang?: Language;
  onClose: () => void;
  onPaymentSuccess: (finalBill: BillDoc) => void;
}

type PaymentTabId = 'cash' | 'qr' | 'master' | 'aripay';

interface PaymentTabConfig {
  id: PaymentTabId;
  method: PaymentMethod;
  subMethod?: string;
  labelTh: string;
  labelEn: string;
}

const PAYMENT_TABS: PaymentTabConfig[] = [
  { id: 'cash', method: 'cash', labelTh: 'เงินสด', labelEn: 'Cash' },
  { id: 'qr', method: 'qr', labelTh: 'QR Payment', labelEn: 'QR Payment' },
  { id: 'master', method: 'card', subMethod: 'Master', labelTh: 'Master', labelEn: 'Master' },
  { id: 'aripay', method: 'qr', subMethod: 'Aripay', labelTh: 'Aripay', labelEn: 'Aripay' },
];

function getSmartQuickCashAmounts(due: number): number[] {
  if (!Number.isFinite(due) || due <= 0) return [20, 50, 100];
  const bases = [20, 50, 100, 500, 1000];
  const set = new Set<number>();
  for (const step of bases) {
    const val = Math.ceil((due + 0.01) / step) * step;
    if (val > due) set.add(val);
  }
  const sorted = Array.from(set).sort((a, b) => a - b);
  while (sorted.length < 3) {
    const last = sorted[sorted.length - 1] ?? Math.ceil(due);
    sorted.push(Math.ceil((last + 1) / 100) * 100);
  }
  return sorted.slice(0, 3);
}

const TabIcon: React.FC<{ tabId: PaymentTabId; active: boolean }> = ({ tabId, active }) => {
  const strokeClass = active ? 'text-orange-600' : 'text-neutral-400';

  if (tabId === 'cash') {
    return <Banknote className={`w-5 h-5 shrink-0 ${strokeClass}`} />;
  }
  if (tabId === 'qr') {
    return <QrCode className={`w-5 h-5 shrink-0 ${strokeClass}`} />;
  }
  if (tabId === 'master') {
    return (
      <span
        className={`inline-flex items-center justify-center w-6 h-4 rounded-[3px] border shrink-0 relative ${
          active ? 'border-orange-500 bg-orange-500 text-white' : 'border-neutral-400 bg-neutral-200/70 text-neutral-600'
        }`}
      >
        <span className="w-2 h-2 rounded-full bg-current opacity-90 -mr-0.5" />
        <span className="w-2 h-2 rounded-full bg-current opacity-65" />
      </span>
    );
  }
  return <Wallet className={`w-5 h-5 shrink-0 ${strokeClass}`} />;
};

export const PaymentModal: React.FC<Props> = ({
  bill,
  settings,
  lang: propLang,
  onClose,
  onPaymentSuccess,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const t = translations[lang];

  // QR Code Image state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Active tab & split payments
  const [activeTabId, setActiveTabId] = useState<PaymentTabId>('cash');
  const [payments, setPayments] = useState<PaymentSplit[]>([
    { method: 'cash', amount: bill.grandTotal, tendered: bill.grandTotal, change: 0 },
  ]);

  // Cash keypad state
  const [cashInputStr, setCashInputStr] = useState<string>(bill.grandTotal.toFixed(2));
  const [isFreshCashEntry, setIsFreshCashEntry] = useState<boolean>(true);

  // Header utility modals/drawers
  const [showDetailsDrawer, setShowDetailsDrawer] = useState<boolean>(false);
  const [showCheckReceipt, setShowCheckReceipt] = useState<boolean>(false);

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

  const activeTab = useMemo(
    () => PAYMENT_TABS.find((tab) => tab.id === activeTabId) || PAYMENT_TABS[0],
    [activeTabId]
  );

  // Load QR Image & subscribe to Members and Channel in real time
  useEffect(() => {
    if (settings.qrImageId) {
      getImageDoc(settings.qrImageId).then((img) => {
        if (img?.dataUrl) setQrDataUrl(img.dataUrl);
      });
    } else {
      setQrDataUrl(null);
    }

    const unsubMembers = subscribeCollection<MemberDoc>('members', (mems) => setMembers(mems));
    const unsubChannels = subscribeCollection<ChannelDoc>('channels', (chs) => {
      const match = chs.find((c) => c.id === bill.channelId);
      setBillChannel(match);
    });

    return () => {
      unsubMembers();
      unsubChannels();
    };
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

  // Reset single payment when effective total changes (e.g. points redeemed)
  useEffect(() => {
    setPayments((prev) => {
      if (prev.length === 1) {
        return [
          {
            ...prev[0],
            amount: effectiveGrandTotal,
            tendered: effectiveGrandTotal,
            change: 0,
          },
        ];
      }
      return prev;
    });
    setCashInputStr(effectiveGrandTotal.toFixed(2));
    setIsFreshCashEntry(true);
  }, [effectiveGrandTotal]);

  const cashTendered = useMemo(() => {
    const parsed = parseFloat(cashInputStr);
    return Number.isFinite(parsed) ? roundTo2(Math.max(0, parsed)) : 0;
  }, [cashInputStr]);

  const totalAllocated = roundTo2(payments.reduce((sum, p) => sum + p.amount, 0));
  const remainingDue = roundTo2(effectiveGrandTotal - totalAllocated);

  const cashSplit = payments.find((p) => p.method === 'cash');
  const cashDueAmount = cashSplit ? cashSplit.amount : effectiveGrandTotal;

  const calculatedChange =
    cashSplit && cashTendered >= cashSplit.amount
      ? calculateChangeDue(cashTendered, cashSplit.amount)
      : 0;

  const estimatedPointsEarned = calculatePointsEarned(effectiveNetSales, settings.pointsEarnUnitThb);

  const quickCashSuggestions = useMemo(
    () => getSmartQuickCashAmounts(cashDueAmount),
    [cashDueAmount]
  );

  // Display values for top summary cards
  const isCashMode = activeTab.method === 'cash';
  const receivedDisplayAmount = isCashMode ? cashTendered : effectiveGrandTotal;
  const amountDueDisplay = isCashMode && payments.length > 1 ? cashDueAmount : effectiveGrandTotal;
  const changeDisplayAmount = isCashMode ? calculatedChange : 0;

  // Validation
  const isCashShort =
    Boolean(cashSplit) && cashTendered < (cashSplit?.amount ?? 0) - 0.01;
  const isSplitMismatch = Math.abs(remainingDue) > 0.05;
  const canConfirm = !isSubmitting && !isCashShort && !isSplitMismatch;

  const handleSelectTab = (tab: PaymentTabConfig) => {
    setActiveTabId(tab.id);
    setErrorMsg(null);
    // In single-payment mode (standard 1-tap flow), switch the payment method directly
    if (payments.length <= 1) {
      setPayments([
        {
          method: tab.method,
          ...(tab.subMethod ? { subMethod: tab.subMethod } : {}),
          amount: effectiveGrandTotal,
          tendered: effectiveGrandTotal,
          change: 0,
        },
      ]);
      if (tab.method === 'cash') {
        setCashInputStr(effectiveGrandTotal.toFixed(2));
        setIsFreshCashEntry(true);
      }
    }
  };

  const handleAddSplitMethod = (tab: PaymentTabConfig) => {
    if (remainingDue <= 0) return;
    setPayments([
      ...payments,
      {
        method: tab.method,
        ...(tab.subMethod ? { subMethod: tab.subMethod } : {}),
        amount: remainingDue,
        tendered: remainingDue,
        change: 0,
      },
    ]);
  };

  const handleRemoveSplit = (index: number) => {
    if (payments.length <= 1) return;
    const next = [...payments];
    next.splice(index, 1);
    setPayments(next);
  };

  const handleUpdateSplitAmount = (index: number, newAmount: number) => {
    const next = [...payments];
    next[index] = {
      ...next[index],
      amount: Math.max(0, newAmount),
    };
    setPayments(next);
  };

  // Keypad handlers
  const handleKeypadKey = useCallback(
    (key: string) => {
      setErrorMsg(null);
      if (key === 'C') {
        setCashInputStr('0');
        setIsFreshCashEntry(false);
        return;
      }

      if (key === 'BACK') {
        if (isFreshCashEntry) {
          setCashInputStr('0');
          setIsFreshCashEntry(false);
          return;
        }
        setCashInputStr((prev) => {
          if (prev.length <= 1) return '0';
          const next = prev.slice(0, -1);
          return next === '' ? '0' : next;
        });
        return;
      }

      if (key === '.') {
        if (isFreshCashEntry) {
          setCashInputStr('0.');
          setIsFreshCashEntry(false);
          return;
        }
        setCashInputStr((prev) => (prev.includes('.') ? prev : `${prev}.`));
        return;
      }

      if (key === '00') {
        if (isFreshCashEntry) {
          setCashInputStr('0');
          setIsFreshCashEntry(false);
          return;
        }
        setCashInputStr((prev) => {
          if (prev === '0') return '0';
          if (prev.includes('.')) {
            const [, decimals] = prev.split('.');
            if (decimals.length >= 2) return prev;
            if (decimals.length === 1) return `${prev}0`;
          }
          if (prev.length >= 9) return prev;
          return `${prev}00`;
        });
        return;
      }

      // Single digit '0'-'9'
      if (isFreshCashEntry) {
        setCashInputStr(key);
        setIsFreshCashEntry(false);
        return;
      }

      setCashInputStr((prev) => {
        if (prev === '0') return key;
        if (prev.includes('.')) {
          const [, decimals] = prev.split('.');
          if (decimals.length >= 2) return prev;
        }
        if (prev.length >= 10) return prev;
        return `${prev}${key}`;
      });
    },
    [isFreshCashEntry]
  );

  const handleQuickCash = (amount: number) => {
    setErrorMsg(null);
    setCashInputStr(amount.toFixed(2));
    setIsFreshCashEntry(true);
  };

  // Physical keyboard numeric input when drawer/receipt modal aren't open
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showDetailsDrawer || showCheckReceipt) {
        if (e.key === 'Escape') {
          setShowDetailsDrawer(false);
          setShowCheckReceipt(false);
        }
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (isCashMode) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          handleKeypadKey(e.key);
        } else if (e.key === '.') {
          e.preventDefault();
          handleKeypadKey('.');
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          handleKeypadKey('BACK');
        } else if (e.key === 'Delete') {
          e.preventDefault();
          handleKeypadKey('C');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCashMode, showDetailsDrawer, showCheckReceipt, handleKeypadKey]);

  const handleProcessPayment = async () => {
    if (isSplitMismatch) {
      setErrorMsg(
        lang === 'th'
          ? `ยอดชำระไม่ตรงกับยอดสุทธิ (คงเหลือ ฿${formatMoney(remainingDue)})`
          : `Payment amount does not match grand total. Remaining: ฿${formatMoney(remainingDue)}`
      );
      return;
    }

    if (isCashShort) {
      setErrorMsg(
        lang === 'th'
          ? `จำนวนเงินสดที่ได้รับน้อยกว่ายอดที่ต้องชำระ (฿${formatMoney(cashDueAmount)})`
          : `Cash tendered is less than amount due (฿${formatMoney(cashDueAmount)})`
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
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

  const billDisplayName = [bill.channelName, bill.tableName].filter(Boolean).join(' - ') || bill.billNumber;
  const headerTitle =
    lang === 'th'
      ? `ชำระเงิน ${billDisplayName} - ฿${formatMoney(effectiveGrandTotal)}`
      : `Payment ${billDisplayName} - ฿${formatMoney(effectiveGrandTotal)}`;

  const hasCustomOptionsActive = Boolean(matchedMember || pointsToRedeem > 0 || payments.length > 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-[#f3f4f6] w-full max-w-4xl max-h-[94vh] max-h-[94dvh] rounded-xl sm:rounded-2xl shadow-2xl border border-neutral-300/90 flex flex-col overflow-hidden">
        {/* Top Bar matching reference */}
        <div className="bg-[#f1f3f5] border-b border-neutral-200 px-2 sm:px-4 h-13 sm:h-14 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/70 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <h3 className="flex-1 text-center text-sm sm:text-base font-bold text-neutral-800 truncate px-2 tabular-nums">
            {headerTitle}
          </h3>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowCheckReceipt(true)}
              title={t.pos.printCheckReceipt}
              aria-label={t.pos.printCheckReceipt}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-200/70 transition-colors cursor-pointer"
            >
              <Printer className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setShowDetailsDrawer((prev) => !prev)}
              title={lang === 'th' ? 'รายละเอียดบิล / สมาชิก / แยกจ่าย' : 'Bill Details / Member / Split'}
              aria-label="Bill Details"
              className={`relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                showDetailsDrawer
                  ? 'bg-neutral-200 text-neutral-900'
                  : 'text-neutral-400 hover:text-neutral-800 hover:bg-neutral-200/70'
              }`}
            >
              <FileText className="w-5 h-5" />
              {hasCustomOptionsActive && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-emerald-500" />
              )}
            </button>
          </div>
        </div>

        {/* Main 2-Column Body */}
        <div className="relative flex-1 min-h-0 flex flex-col md:flex-row bg-[#f3f4f6] overflow-hidden">
          {/* Left Sidebar: Payment Method List */}
          <div className="md:w-48 lg:w-52 shrink-0 p-2 md:py-3 md:pl-3 md:pr-1.5 grid grid-cols-2 sm:grid-cols-4 md:flex md:flex-col gap-1.5 border-b md:border-b-0 border-neutral-200 overflow-y-auto overscroll-contain">
            {PAYMENT_TABS.map((tab) => {
              const isActive = activeTabId === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectTab(tab)}
                  className={`min-h-[44px] px-2.5 md:px-4 py-2.5 md:py-3.5 rounded-md flex items-center justify-center md:justify-start gap-2 md:gap-3 text-xs sm:text-sm transition-all cursor-pointer ${
                    isActive
                      ? 'bg-orange-100 text-orange-900 font-bold shadow-xs border border-orange-300'
                      : 'bg-transparent text-neutral-500 hover:text-orange-800 hover:bg-orange-50/70 font-medium border border-transparent'
                  }`}
                >
                  <TabIcon tabId={tab.id} active={isActive} />
                  <span className="truncate">{lang === 'th' ? tab.labelTh : tab.labelEn}</span>
                </button>
              );
            })}
          </div>

          {/* Right Main Workspace */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 p-3 sm:p-4 md:pl-2.5 flex flex-col gap-2.5 sm:gap-3 overflow-y-auto overscroll-contain">
            {errorMsg && (
              <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-md text-rose-800 text-xs font-semibold flex items-center gap-2 shrink-0">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Split indicator banner if multiple payments configured */}
            {payments.length > 1 && (
              <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-sm flex items-center justify-between text-xs text-amber-900 shrink-0">
                <span className="font-semibold">
                  {t.pos.splitPayment} ({payments.length}{' '}
                  {lang === 'th' ? 'รายการ' : 'methods'})
                </span>
                <button
                  type="button"
                  onClick={() => setShowDetailsDrawer(true)}
                  className="font-bold underline cursor-pointer hover:text-amber-700"
                >
                  {lang === 'th' ? 'แก้ไขการแยกจ่าย' : 'Edit Split'}
                </button>
              </div>
            )}

            {/* Top Amount Summary Row (Received / Amount Due | Change) */}
            <div className="flex flex-col sm:flex-row gap-2.5 shrink-0">
              <div className="flex-1 bg-white border border-neutral-200 rounded-sm px-4 py-2.5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] sm:text-xs text-neutral-400 font-medium mb-0.5">
                    {lang === 'th' ? 'ได้รับแล้ว' : 'Received'}
                  </div>
                  <div
                    className={`text-lg sm:text-xl font-bold tabular-nums ${
                      isCashMode && isCashShort ? 'text-rose-600' : 'text-neutral-900'
                    }`}
                  >
                    ฿{formatMoney(receivedDisplayAmount)}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[11px] sm:text-xs text-neutral-400 font-medium mb-0.5">
                    {lang === 'th' ? 'ยอดชำระ' : 'Amount Due'}
                  </div>
                  <div className="text-lg sm:text-xl font-semibold text-neutral-600 tabular-nums">
                    ฿{formatMoney(amountDueDisplay)}
                  </div>
                </div>
              </div>

              <div className="sm:w-44 md:w-48 bg-white border border-neutral-200 rounded-sm px-4 py-2.5 flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center">
                <div className="text-[11px] sm:text-xs text-neutral-400 font-medium sm:mb-0.5">
                  {lang === 'th' ? 'เงินทอน' : 'Change'}
                </div>
                <div
                  className={`text-lg sm:text-xl font-bold tabular-nums ${
                    changeDisplayAmount > 0 ? 'text-emerald-600' : 'text-neutral-900'
                  }`}
                >
                  ฿{formatMoney(changeDisplayAmount)}
                </div>
              </div>
            </div>

            {/* Center Panel: Cash Keypad vs QR/Transfer vs Card */}
            {isCashMode ? (
              <>
                {/* 3 Quick Cash Banknote Suggestions */}
                <div className="grid grid-cols-3 bg-neutral-200 gap-px border border-neutral-200 rounded-sm overflow-hidden shrink-0">
                  {quickCashSuggestions.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleQuickCash(preset)}
                      className="min-h-[44px] py-2.5 bg-white hover:bg-emerald-50/70 active:bg-emerald-100 text-[#2ea44f] font-semibold text-sm sm:text-base tabular-nums transition-colors cursor-pointer"
                    >
                      ฿{preset.toLocaleString('en-US')}
                    </button>
                  ))}
                </div>

                {/* 4x4 POS Numeric Keypad Grid */}
                <div className="flex-1 min-h-[220px] sm:min-h-[250px] bg-neutral-200 gap-px border border-neutral-200 rounded-sm overflow-hidden grid grid-cols-4 grid-rows-4 select-none">
                  {/* Row 1 */}
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('7')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    7
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('8')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    8
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('9')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    9
                  </button>
                  {/* Backspace spanning rows 1-2 */}
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('BACK')}
                    aria-label="Backspace"
                    className="row-span-2 bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-500 flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Delete className="w-6 h-6 stroke-[1.75]" />
                  </button>

                  {/* Row 2 */}
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('4')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    4
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('5')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    5
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('6')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    6
                  </button>

                  {/* Row 3 */}
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('1')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('2')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    2
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('3')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    3
                  </button>
                  {/* Clear spanning rows 3-4 */}
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('C')}
                    aria-label="Clear"
                    className="row-span-2 bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-600 text-lg sm:text-xl font-semibold flex items-center justify-center cursor-pointer transition-colors"
                  >
                    C
                  </button>

                  {/* Row 4 */}
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('0')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('00')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    00
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadKey('.')}
                    className="bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 text-lg sm:text-xl font-medium flex items-center justify-center cursor-pointer transition-colors"
                  >
                    .
                  </button>
                </div>
              </>
            ) : activeTab.id === 'qr' ? (
              <div className="flex-1 min-h-[240px] bg-white border border-neutral-200 rounded-sm p-4 sm:p-6 flex flex-col items-center justify-center text-center gap-3">
                <div className="text-sm font-bold text-neutral-800">
                  {t.pos.scanQrToPay}
                </div>
                {qrDataUrl ? (
                  <div className="p-2.5 bg-white rounded-lg border border-neutral-200 shadow-xs">
                    <img
                      src={qrDataUrl}
                      alt="PromptPay QR"
                      className="w-44 h-44 sm:w-48 sm:h-48 object-contain"
                    />
                  </div>
                ) : (
                  <div className="p-6 bg-neutral-50 rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-500 max-w-xs">
                    {t.pos.noQrUploaded}
                  </div>
                )}
                <div className="text-base font-bold text-neutral-900 tabular-nums">
                  {lang === 'th' ? 'ยอดโอน:' : 'Transfer Amount:'} ฿
                  {formatMoney(effectiveGrandTotal)}
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-[240px] bg-white border border-neutral-200 rounded-sm p-6 flex flex-col items-center justify-center text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                  {activeTab.id === 'aripay' ? (
                    <Wallet className="w-7 h-7" />
                  ) : (
                    <CreditCard className="w-7 h-7" />
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-base font-bold text-neutral-900">
                    {lang === 'th'
                      ? `รับชำระผ่าน ${activeTab.labelTh}`
                      : `Pay with ${activeTab.labelEn}`}
                  </div>
                  <p className="text-xs text-neutral-500">
                    {activeTab.id === 'aripay'
                      ? lang === 'th'
                        ? 'ตรวจสอบยอดรับชำระผ่าน Aripay แล้วกดยืนยันการชำระเงิน'
                        : 'Verify the Aripay payment and tap Confirm Payment'
                      : lang === 'th'
                        ? 'ตรวจสอบยอดบนเครื่องรูดบัตร แล้วกดยืนยันการชำระเงิน'
                        : 'Verify the charge on your payment terminal and tap Confirm Payment'}
                  </p>
                </div>
                <div className="mt-1 px-5 py-2 bg-neutral-50 border border-neutral-200 rounded-md text-xl font-bold text-neutral-900 tabular-nums">
                  ฿{formatMoney(effectiveGrandTotal)}
                </div>
              </div>
            )}

            </div>

            {/* Pinned Full-Width Green Confirm CTA */}
            <div className="shrink-0 px-3 sm:px-4 md:pl-2.5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[#f3f4f6] border-t border-neutral-200/80">
              <button
                type="button"
                disabled={!canConfirm}
                onClick={handleProcessPayment}
                className="w-full min-h-[48px] py-3 sm:py-3.5 px-6 bg-[#31b237] hover:bg-[#2aa02f] active:scale-[0.99] text-white rounded-sm font-bold text-sm sm:text-base flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <span>{t.common.loading}</span>
                ) : (
                  <span>{lang === 'th' ? 'ยืนยันการชำระเงิน' : 'Confirm Payment'}</span>
                )}
              </button>
            </div>
          </div>

          {/* Inline Slide-Over Panel for Bill Breakdown, Member Points & Split Payment */}
          {showDetailsDrawer && (
            <div className="absolute inset-0 z-20 bg-neutral-950/35 flex justify-end">
              <div className="w-full max-w-md bg-white h-full shadow-2xl border-l border-neutral-200 flex flex-col overflow-hidden">
                <div className="px-4 py-3 bg-[#f1f3f5] border-b border-neutral-200 flex items-center justify-between shrink-0">
                  <div className="font-bold text-sm text-neutral-900">
                    {lang === 'th'
                      ? 'รายละเอียดบิล / สมาชิก / แยกจ่าย'
                      : 'Bill Details / Member / Split'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDetailsDrawer(false)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/70 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4">
                  {/* Bill Summary Grid */}
                  <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg space-y-1.5 text-xs">
                    <div className="flex justify-between text-neutral-600">
                      <span>{t.pos.subtotal}</span>
                      <span className="font-semibold tabular-nums">฿{formatMoney(bill.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-rose-600">
                      <span>{t.pos.discount}</span>
                      <span className="font-semibold tabular-nums">
                        -฿{formatMoney(bill.discountAmount + pointsDiscountValue)}
                      </span>
                    </div>
                    <div className="flex justify-between text-neutral-600">
                      <span>VAT / SC</span>
                      <span className="font-semibold tabular-nums">
                        ฿{formatMoney(bill.vatAmount + bill.serviceChargeAmount)}
                      </span>
                    </div>
                    <div className="pt-1.5 border-t border-neutral-200 flex justify-between text-sm font-bold text-neutral-900">
                      <span>{t.pos.grandTotal}</span>
                      <span className="tabular-nums">฿{formatMoney(effectiveGrandTotal)}</span>
                    </div>
                  </div>

                  {/* Member Points */}
                  <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-800">
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                        <span>{t.pos.memberPoints}</span>
                      </div>
                      {matchedMember && (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
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
                        className="flex-1 px-3 py-2 text-xs bg-white border border-neutral-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                      {matchedMember && matchedMember.points > 0 && (
                        <div className="flex items-center gap-1.5">
                          <NumericInput
                            max={matchedMember.points}
                            min={0}
                            value={pointsToRedeem}
                            onValueChange={(val) =>
                              setPointsToRedeem(
                                Math.min(matchedMember.points, Math.max(0, Math.round(val)))
                              )
                            }
                            className="w-20 px-2 py-2 text-xs text-center font-bold bg-white border border-amber-300 rounded-md focus:ring-2 focus:ring-amber-500"
                            placeholder={lang === 'th' ? 'แต้ม' : 'Pts'}
                          />
                          <span className="text-xs text-amber-800 font-bold tabular-nums">
                            -฿{formatMoney(pointsDiscountValue)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Split Payment Manager */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-neutral-800">{t.pos.splitPayment}</span>
                      {remainingDue > 0 && (
                        <span className="text-xs font-bold text-amber-700 tabular-nums">
                          {lang === 'th' ? 'คงเหลือ:' : 'Remaining:'} ฿{formatMoney(remainingDue)}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {payments.map((p, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2 bg-neutral-50 rounded-md border border-neutral-200 text-xs"
                        >
                          <span className="w-24 font-bold text-neutral-800 truncate">
                            {p.subMethod ||
                              (lang === 'th'
                                ? PAYMENT_TABS.find((tItem) => tItem.method === p.method)?.labelTh ||
                                  p.method
                                : p.method)}
                          </span>
                          <NumericInput
                            min={0}
                            step={1}
                            value={p.amount}
                            onValueChange={(val) => handleUpdateSplitAmount(idx, val)}
                            className="flex-1 px-2.5 py-1.5 bg-white border border-neutral-300 rounded-md font-bold text-right tabular-nums"
                          />
                          {payments.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSplit(idx)}
                              className="p-1.5 text-rose-600 hover:text-rose-800 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {remainingDue > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {PAYMENT_TABS.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => handleAddSplitMethod(tab)}
                            className="px-2.5 py-1.5 bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-700 rounded-md text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3 h-3 text-emerald-600" />
                            <span>{lang === 'th' ? tab.labelTh : tab.labelEn}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-neutral-200 bg-neutral-50">
                  <button
                    type="button"
                    onClick={() => setShowDetailsDrawer(false)}
                    className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-md text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>{t.common.confirm}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Check Receipt Preview Modal triggered by Printer button */}
      {showCheckReceipt && (
        <ReceiptModal
          bill={{
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
            ...(matchedMember?.name ? { memberName: matchedMember.name } : {}),
          }}
          settings={settings}
          lang={lang}
          isCheckReceipt={true}
          onClose={() => setShowCheckReceipt(false)}
        />
      )}
    </div>
  );
};
