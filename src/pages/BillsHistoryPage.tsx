import React, { useState, useEffect, useMemo } from 'react';
import {
  BillDoc,
  BillStatus,
  CategoryDoc,
  DishDoc,
  SettingsDoc,
  ShiftDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import { useLanguage } from '../contexts/LanguageContext';
import { formatMoney, getBusinessWorkDate } from '../engine/calculations';
import {
  SalesReportTabId,
  ReportChannelFilter,
  formatReportDateDisplay,
  filterBillsByChannel,
  buildSalesSummary,
  buildPaymentMethodsReport,
  buildCategorySalesReport,
  buildBestSellersReport,
  buildModifiersReport,
  buildMemberSalesReport,
  buildUserSalesReport,
  buildDiscountsReport,
} from '../engine/salesReports';
import {
  auth,
  subscribeBillsWithFilter,
  subscribeCollection,
  voidBillAtomic,
} from '../data/db';
import { ReceiptModal } from '../components/ReceiptModal';
import { DeliveryAddressModal } from '../components/DeliveryAddressModal';
import { SalesSummaryPrintModal } from '../components/SalesSummaryPrintModal';
import {
  ArrowLeft,
  BarChart3,
  CreditCard,
  Users,
  Crown,
  PiggyBank,
  PieChart,
  TrendingUp,
  ListChecks,
  Percent,
  FileText,
  Printer,
  Ban,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  MapPin,
  Search,
  Menu,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang?: Language;
  onBack?: () => void;
}

type DatePreset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'custom';

export const BillsHistoryPage: React.FC<Props> = ({ settings, lang: propLang, onBack }) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const t = translations[lang];

  // Report Navigation & Channel Tabs
  const [activeReport, setActiveReport] = useState<SalesReportTabId>('sales_summary');
  const [channelFilter, setChannelFilter] = useState<ReportChannelFilter>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Date & Bill List Filters
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDate, setCustomDate] = useState<string>(
    getBusinessWorkDate(new Date(), settings.dailyClosingTime)
  );
  const [statusFilter, setStatusFilter] = useState<BillStatus | 'all'>('all');
  const [billSearch, setBillSearch] = useState('');

  // Firestore Real-time Data
  const [bills, setBills] = useState<BillDoc[]>([]);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [shifts, setShifts] = useState<ShiftDoc[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Pagination for bill_list view
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Modals (View, Reprint Receipt, Print Address, Print Summary, Void)
  const [selectedBillForDetails, setSelectedBillForDetails] = useState<BillDoc | null>(null);
  const [receiptBillToView, setReceiptBillToView] = useState<BillDoc | null>(null);
  const [addressBillToPrint, setAddressBillToPrint] = useState<BillDoc | null>(null);
  const [isSummaryPrintOpen, setIsSummaryPrintOpen] = useState(false);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [billToVoid, setBillToVoid] = useState<BillDoc | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);

  // Compute date range
  const { startDate, endDate } = useMemo(() => {
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
    return { startDate: customDate, endDate: customDate };
  }, [datePreset, customDate, settings.dailyClosingTime]);

  useEffect(() => {
    setIsLoading(true);
    const unsubBills = subscribeBillsWithFilter(
      {
        status: 'all',
        startDate,
        endDate,
        limitCount: 500,
      },
      (data) => {
        const sorted = [...data].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setBills(sorted);
        setPage(1);
        setIsLoading(false);
      },
      (err) => {
        console.error('Error subscribing bills:', err);
        setIsLoading(false);
      }
    );

    const unsubDishes = subscribeCollection<DishDoc>(
      'dishes',
      (data) => setDishes(data),
      (err) => console.warn('BillsHistory dishes warning:', err)
    );
    const unsubCats = subscribeCollection<CategoryDoc>(
      'categories',
      (data) => setCategories(data),
      (err) => console.warn('BillsHistory categories warning:', err)
    );
    const unsubShifts = subscribeCollection<ShiftDoc>(
      'shifts',
      (data) => setShifts(data),
      (err) => console.warn('BillsHistory shifts warning:', err)
    );

    return () => {
      unsubBills();
      unsubDishes();
      unsubCats();
      unsubShifts();
    };
  }, [startDate, endDate]);

  useEffect(() => {
    setPage(1);
  }, [channelFilter, statusFilter, billSearch]);

  const handleConfirmVoid = async () => {
    if (!billToVoid || !voidReason.trim()) return;
    setIsSubmittingVoid(true);
    try {
      await voidBillAtomic(billToVoid.id, voidReason.trim());
      setIsVoidModalOpen(false);
      setBillToVoid(null);
      setVoidReason('');
    } catch (err) {
      console.error('Void error:', err);
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  // Derived Report Datasets
  const summary = useMemo(
    () => buildSalesSummary(bills, channelFilter),
    [bills, channelFilter]
  );

  const paymentStats = useMemo(
    () => buildPaymentMethodsReport(summary.paidBills),
    [summary.paidBills]
  );

  const categoryStats = useMemo(
    () => buildCategorySalesReport(summary.paidBills, dishes, categories, lang),
    [summary.paidBills, dishes, categories, lang]
  );

  const bestSellers = useMemo(
    () => buildBestSellersReport(summary.paidBills),
    [summary.paidBills]
  );

  const modifierStats = useMemo(
    () => buildModifiersReport(summary.paidBills),
    [summary.paidBills]
  );

  const memberStats = useMemo(
    () => buildMemberSalesReport(summary.paidBills, lang),
    [summary.paidBills, lang]
  );

  const userStats = useMemo(
    () => buildUserSalesReport(summary.paidBills, shifts, auth?.currentUser?.email, lang),
    [summary.paidBills, shifts, lang]
  );

  const discountsReport = useMemo(
    () => buildDiscountsReport(summary.paidBills),
    [summary.paidBills]
  );

  const filteredBillList = useMemo(() => {
    const channelScoped = filterBillsByChannel(bills, channelFilter);
    const q = billSearch.trim().toLowerCase();
    return channelScoped.filter((bill) => {
      if (statusFilter !== 'all' && bill.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (bill.billNumber || '').toLowerCase().includes(q) ||
        (bill.tableName || '').toLowerCase().includes(q) ||
        (bill.customerName || '').toLowerCase().includes(q) ||
        (bill.customerPhone || '').toLowerCase().includes(q) ||
        (bill.channelName || '').toLowerCase().includes(q)
      );
    });
  }, [bills, channelFilter, statusFilter, billSearch]);

  const paginatedBills = filteredBillList.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(filteredBillList.length / pageSize) || 1;

  const dateDisplayLabel = useMemo(
    () => formatReportDateDisplay(startDate, endDate, lang),
    [startDate, endDate, lang]
  );

  const reportNavItems: {
    id: SalesReportTabId;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }[] = [
    {
      id: 'sales_summary',
      label: lang === 'th' ? 'สรุปยอดขาย' : 'Sales Summary',
      icon: BarChart3,
    },
    {
      id: 'payment_methods',
      label: lang === 'th' ? 'วิธีการชำระเงิน' : 'Payment Methods',
      icon: CreditCard,
    },
    {
      id: 'by_user',
      label: lang === 'th' ? 'ยอดขายตามผู้ใช้งาน' : 'Sales by Staff',
      icon: Users,
    },
    {
      id: 'by_member',
      label: lang === 'th' ? 'ยอดขายตามสมาชิก' : 'Sales by Member',
      icon: Crown,
    },
    {
      id: 'taxes_fees',
      label: lang === 'th' ? 'ภาษีและค่าธรรมเนียมอื่นๆ' : 'Taxes & Other Fees',
      icon: PiggyBank,
    },
    {
      id: 'by_category',
      label: lang === 'th' ? 'ยอดขายตามประเภท' : 'Sales by Category',
      icon: PieChart,
    },
    {
      id: 'best_sellers',
      label: lang === 'th' ? 'รายการขายดี' : 'Best Selling Items',
      icon: TrendingUp,
    },
    {
      id: 'modifiers',
      label: lang === 'th' ? 'เมนูย่อย' : 'Sub-Options / Modifiers',
      icon: ListChecks,
    },
    {
      id: 'discounts',
      label: lang === 'th' ? 'ส่วนลดที่ถูกใช้' : 'Discounts Used',
      icon: Percent,
    },
    {
      id: 'bill_list',
      label: lang === 'th' ? 'รายการบิลทั้งหมด' : 'All Bills & Receipts',
      icon: FileText,
      badge: bills.length,
    },
  ];

  const channelTabs: { id: ReportChannelFilter; label: string }[] = [
    { id: 'all', label: lang === 'th' ? 'ทั้งหมด' : 'All' },
    { id: 'dine_in', label: lang === 'th' ? 'ทานที่ร้าน' : 'Dine-In' },
    { id: 'takeaway', label: lang === 'th' ? 'สั่งกลับบ้าน' : 'Takeaway' },
    { id: 'delivery', label: 'Delivery' },
  ];

  const getChannelDisplayLabel = (id: ReportChannelFilter) => {
    return channelTabs.find((c) => c.id === id)?.label || id;
  };

  const getPaymentLabel = (method: string) => {
    if (method === 'cash') return lang === 'th' ? 'เงินสด' : 'Cash';
    if (method === 'qr') return lang === 'th' ? 'พร้อมเพย์ / QR' : 'QR Payment';
    if (method === 'card') return lang === 'th' ? 'บัตรเครดิต' : 'Credit Card';
    return lang === 'th' ? 'โอนเงินธนาคาร' : 'Bank Transfer';
  };

  const activeReportMeta = reportNavItems.find((r) => r.id === activeReport) || reportNavItems[0];

  const handleSelectReport = (id: SalesReportTabId) => {
    setActiveReport(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 select-none">
      {/* Unified Two-Pane Report Shell (Matches POS Report Window) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col md:flex-row md:min-h-[calc(100dvh-108px)]">
        {/* LEFT SIDEBAR: Report Navigation Menu */}
        <aside
          className={`${
            mobileMenuOpen ? 'flex' : 'hidden md:flex'
          } w-full md:w-72 lg:w-[305px] shrink-0 bg-slate-50/80 md:border-r border-b md:border-b-0 border-slate-200 flex-col`}
        >
          {/* Sidebar Header */}
          <div className="px-4 py-3.5 border-b border-slate-200 bg-white flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (mobileMenuOpen) {
                  setMobileMenuOpen(false);
                } else {
                  onBack?.();
                }
              }}
              aria-label={lang === 'th' ? 'ย้อนกลับ' : 'Back'}
              className="p-1.5 -ml-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-base font-bold text-slate-800 tracking-tight">
              {lang === 'th' ? 'รายงาน' : 'Reports'}
            </h2>
            <div className="w-8" />
          </div>

          {/* Sidebar Report Items */}
          <nav className="flex-1 overflow-y-auto divide-y divide-slate-200/80">
            {reportNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeReport === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectReport(item.id)}
                  className={`w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left text-sm transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-50/80 text-emerald-700 font-bold'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span
                      className={`text-xs tabular-nums ${
                        isActive ? 'text-emerald-700 font-bold' : 'text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Bottom Print Summary Slip Button */}
          <div className="border-t border-slate-200 bg-white p-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsSummaryPrintOpen(true)}
              className="w-full py-2.5 px-4 rounded-xl text-emerald-700 hover:bg-emerald-50 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>{lang === 'th' ? 'พิมพ์ใบสรุปยอด' : 'Print Sales Summary'}</span>
            </button>
          </div>
        </aside>

        {/* RIGHT PANEL: Active Report Details */}
        <section className="flex-1 min-w-0 bg-white flex flex-col">
          {/* Mobile Bar to Switch Report Menu */}
          <div className="md:hidden px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-800 cursor-pointer"
            >
              <Menu className="w-4 h-4 text-emerald-700" />
              <span>{activeReportMeta.label}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsSummaryPrintOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{lang === 'th' ? 'พิมพ์สรุป' : 'Summary'}</span>
            </button>
          </div>

          {/* Top Channel Filter Tabs (ทั้งหมด | ทานที่ร้าน | สั่งกลับบ้าน | Delivery) */}
          <div className="border-b border-slate-200 px-3 sm:px-8 flex items-center justify-around sm:justify-center sm:gap-10 overflow-x-auto bg-white shrink-0">
            {channelTabs.map((tab) => {
              const isActive = channelFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setChannelFilter(tab.id)}
                  className={`py-3.5 px-2 text-sm whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                    isActive
                      ? 'border-slate-900 text-slate-900 font-bold'
                      : 'border-transparent text-slate-400 hover:text-slate-700 font-semibold'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Date Display & Period Filter Bar */}
          <div className="px-4 sm:px-8 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50/40 shrink-0">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-medium text-slate-500">
              <span>{dateDisplayLabel}</span>
              {isLoading && (
                <span className="text-xs text-slate-400">({t.common.loading})</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'today', label: t.bills.today },
                { id: 'yesterday', label: t.bills.yesterday },
                { id: 'last7', label: t.bills.last7Days },
                { id: 'thisMonth', label: t.bills.thisMonth },
                { id: 'custom', label: t.bills.customDate },
              ].map((dp) => (
                <button
                  key={dp.id}
                  type="button"
                  onClick={() => setDatePreset(dp.id as DatePreset)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    datePreset === dp.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                  className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                />
              )}
            </div>
          </div>

          {/* Active Report Body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 space-y-6">
            {/* 1. SALES SUMMARY (สรุปยอดขาย) - Matches Reference Screenshot */}
            {activeReport === 'sales_summary' && (
              <div className="space-y-6">
                {/* Breakdown Table by Channel */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                        <th className="py-2.5 pr-4">{lang === 'th' ? 'ประเภท' : 'Type'}</th>
                        <th className="py-2.5 px-4 text-center">{lang === 'th' ? 'บิล' : 'Bills'}</th>
                        <th className="py-2.5 pl-4 text-right">
                          {lang === 'th' ? 'รวมยอดเงินที่ได้รับ' : 'Total Received'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {summary.channelRows.map((row) => {
                        const isTotalRow = row.id === 'all';
                        const isSelectedChannel = channelFilter === row.id;
                        return (
                          <tr
                            key={row.id}
                            onClick={() => setChannelFilter(row.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelectedChannel
                                ? 'bg-slate-50/80 text-slate-900'
                                : 'text-slate-500 hover:bg-slate-50/50'
                            }`}
                          >
                            <td
                              className={`py-3 pr-4 ${
                                isTotalRow
                                  ? 'text-base font-bold text-slate-900'
                                  : isSelectedChannel
                                  ? 'text-sm font-bold text-slate-900'
                                  : 'text-sm font-normal'
                              }`}
                            >
                              {getChannelDisplayLabel(row.id)}
                            </td>
                            <td
                              className={`py-3 px-4 text-center ${
                                isTotalRow
                                  ? 'text-base font-bold text-slate-900'
                                  : isSelectedChannel
                                  ? 'text-sm font-bold text-slate-900'
                                  : 'text-sm font-normal'
                              }`}
                            >
                              {row.billCount}
                            </td>
                            <td
                              className={`py-3 pl-4 text-right ${
                                isTotalRow
                                  ? 'text-base font-bold text-slate-900'
                                  : isSelectedChannel
                                  ? 'text-sm font-bold text-slate-900'
                                  : 'text-sm font-normal'
                              }`}
                            >
                              ฿{formatMoney(row.receivedTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Details Section */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 pb-2.5 border-b border-slate-200">
                    {lang === 'th' ? 'รายละเอียด' : 'Details'}
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 tabular-nums">
                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'จำนวนลูกค้า' : 'Customers / Paid Bills'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        {summary.customerCount}
                      </div>
                    </div>

                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'ยอดขายต่อคน' : 'Sales per Customer'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        ฿{formatMoney(summary.avgPerCustomer)}
                      </div>
                    </div>

                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'ยอดขายต่อบิล' : 'Sales per Bill'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        ฿{formatMoney(summary.avgPerBill)}
                      </div>
                    </div>

                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'ส่วนลด' : 'Discounts'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        ฿{formatMoney(summary.discountTotal)}
                      </div>
                    </div>

                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'เงินคืน' : 'Refunds / Voided'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        ฿{formatMoney(summary.refundTotal)}
                        {summary.refundCount > 0 && (
                          <span className="text-xs font-normal text-rose-600 ml-1.5">
                            ({summary.refundCount} {lang === 'th' ? 'บิล' : 'bills'})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'ค่าบริการ' : 'Service Charge'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        ฿{formatMoney(summary.serviceChargeTotal)}
                      </div>
                    </div>

                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'เงินเรียกเก็บเพิ่มทั้งหมด' : 'Extra Charges & Fees'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        ฿{formatMoney(summary.extraChargesTotal)}
                      </div>
                    </div>

                    <div className="py-3 border-b border-slate-200 space-y-1">
                      <div className="text-xs text-slate-500">
                        {lang === 'th' ? 'ภาษี' : 'Tax (VAT)'}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        ฿{formatMoney(summary.vatTotal)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Drilldown to Individual Bills */}
                <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div>
                    {summary.savedBills.length > 0 && (
                      <span>
                        {lang === 'th'
                          ? `บิลค้างชำระ / พักบิล: ${summary.savedBills.length} บิล`
                          : `Open / Unpaid bills: ${summary.savedBills.length}`}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectReport('bill_list')}
                    className="text-emerald-700 hover:text-emerald-800 font-semibold hover:underline cursor-pointer"
                  >
                    {lang === 'th'
                      ? `ดูรายการบิลทั้งหมด (${filteredBillList.length}) และจัดการบิล →`
                      : `View all bills (${filteredBillList.length}) & reprint / void →`}
                  </button>
                </div>
              </div>
            )}

            {/* 2. PAYMENT METHODS (วิธีการชำระเงิน) */}
            {activeReport === 'payment_methods' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'th' ? 'ยอดขายแยกตามวิธีการชำระเงิน' : 'Sales by Payment Method'}
                  </h3>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    {lang === 'th' ? 'รวมทั้งหมด:' : 'Total:'} ฿{formatMoney(summary.totalReceived)}
                  </span>
                </div>

                {summary.paidBills.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">{t.common.noData}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                          <th className="py-2.5 pr-4">{lang === 'th' ? 'วิธีชำระเงิน' : 'Method'}</th>
                          <th className="py-2.5 px-4 text-center">{lang === 'th' ? 'จำนวนบิล' : 'Bills'}</th>
                          <th className="py-2.5 px-4 text-right">{lang === 'th' ? 'สัดส่วน' : 'Share'}</th>
                          <th className="py-2.5 pl-4 text-right">{lang === 'th' ? 'ยอดเงิน' : 'Amount'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {paymentStats.map((pm) => (
                          <tr key={pm.method} className="hover:bg-slate-50/70">
                            <td className="py-3 pr-4 font-semibold text-slate-800">
                              {getPaymentLabel(pm.method)}
                            </td>
                            <td className="py-3 px-4 text-center text-slate-600">{pm.billCount}</td>
                            <td className="py-3 px-4 text-right text-slate-500">
                              {pm.sharePercent.toFixed(1)}%
                            </td>
                            <td className="py-3 pl-4 text-right font-bold text-slate-900">
                              ฿{formatMoney(pm.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 3. SALES BY USER / SHIFT (ยอดขายตามผู้ใช้งาน) */}
            {activeReport === 'by_user' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'th' ? 'ยอดขายตามผู้ใช้งานและกะขาย' : 'Sales by User & Shift'}
                  </h3>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    {summary.billCount} {lang === 'th' ? 'บิล' : 'bills'}
                  </span>
                </div>

                {userStats.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">{t.common.noData}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                          <th className="py-2.5 pr-4">{lang === 'th' ? 'ผู้ใช้งาน / กะ' : 'User / Shift'}</th>
                          <th className="py-2.5 px-4 text-center">{lang === 'th' ? 'จำนวนบิล' : 'Bills'}</th>
                          <th className="py-2.5 px-4 text-right">{lang === 'th' ? 'ยอดขายสุทธิ' : 'Net Sales'}</th>
                          <th className="py-2.5 pl-4 text-right">{lang === 'th' ? 'ยอดรับรวม' : 'Total Received'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {userStats.map((u) => (
                          <tr key={u.key} className="hover:bg-slate-50/70">
                            <td className="py-3 pr-4">
                              <div className="font-semibold text-slate-800">{u.label}</div>
                              {u.subLabel && (
                                <div className="text-xs text-slate-500">{u.subLabel}</div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center text-slate-600">{u.billCount}</td>
                            <td className="py-3 px-4 text-right text-slate-600">
                              ฿{formatMoney(u.netSales)}
                            </td>
                            <td className="py-3 pl-4 text-right font-bold text-slate-900">
                              ฿{formatMoney(u.totalReceived)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 4. SALES BY MEMBER (ยอดขายตามสมาชิก) */}
            {activeReport === 'by_member' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'th' ? 'ยอดขายตามสมาชิกและลูกค้า' : 'Sales by Member & Customer'}
                  </h3>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    ฿{formatMoney(summary.totalReceived)}
                  </span>
                </div>

                {memberStats.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">{t.common.noData}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                          <th className="py-2.5 pr-4">{lang === 'th' ? 'สมาชิก / ลูกค้า' : 'Member / Customer'}</th>
                          <th className="py-2.5 px-4 text-center">{lang === 'th' ? 'บิล' : 'Bills'}</th>
                          <th className="py-2.5 px-4 text-right">{lang === 'th' ? 'แต้มที่ได้ / ใช้' : 'Points +/-'}</th>
                          <th className="py-2.5 pl-4 text-right">{lang === 'th' ? 'ยอดซื้อรวม' : 'Total Spent'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {memberStats.map((m) => (
                          <tr key={m.key} className="hover:bg-slate-50/70">
                            <td className="py-3 pr-4">
                              <div className="font-semibold text-slate-800">{m.name}</div>
                              {m.phone && <div className="text-xs text-slate-500">{m.phone}</div>}
                            </td>
                            <td className="py-3 px-4 text-center text-slate-600">{m.billCount}</td>
                            <td className="py-3 px-4 text-right text-xs text-slate-600">
                              +{m.pointsEarned} / -{m.pointsRedeemed}
                            </td>
                            <td className="py-3 pl-4 text-right font-bold text-slate-900">
                              ฿{formatMoney(m.totalSpent)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 5. TAXES & OTHER FEES (ภาษีและค่าธรรมเนียมอื่นๆ) */}
            {activeReport === 'taxes_fees' && (
              <div className="space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-2.5">
                  {lang === 'th' ? 'ภาษีและค่าธรรมเนียมอื่นๆ' : 'Taxes & Other Fees'}
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 tabular-nums">
                  <div className="py-3 border-b border-slate-200 space-y-1">
                    <div className="text-xs text-slate-500">
                      {lang === 'th' ? 'ยอดขายสุทธิ (Net Sales)' : 'Net Sales'}
                    </div>
                    <div className="text-base font-semibold text-slate-900">
                      ฿{formatMoney(summary.netSalesTotal)}
                    </div>
                  </div>

                  <div className="py-3 border-b border-slate-200 space-y-1">
                    <div className="text-xs text-slate-500">
                      {lang === 'th'
                        ? `ภาษีมูลค่าเพิ่ม (VAT ${settings.vatPercent}%)`
                        : `VAT (${settings.vatPercent}%)`}
                    </div>
                    <div className="text-base font-semibold text-slate-900">
                      ฿{formatMoney(summary.vatTotal)}
                    </div>
                  </div>

                  <div className="py-3 border-b border-slate-200 space-y-1">
                    <div className="text-xs text-slate-500">
                      {lang === 'th'
                        ? `ค่าบริการ (Service Charge ${settings.serviceChargePercent}%)`
                        : `Service Charge (${settings.serviceChargePercent}%)`}
                    </div>
                    <div className="text-base font-semibold text-slate-900">
                      ฿{formatMoney(summary.serviceChargeTotal)}
                    </div>
                  </div>

                  <div className="py-3 border-b border-slate-200 space-y-1">
                    <div className="text-xs text-slate-500">
                      {lang === 'th' ? 'ค่าบรรจุภัณฑ์ (Packaging)' : 'Packaging Costs'}
                    </div>
                    <div className="text-base font-semibold text-slate-900">
                      ฿{formatMoney(summary.packagingTotal)}
                    </div>
                  </div>

                  <div className="py-3 border-b border-slate-200 space-y-1">
                    <div className="text-xs text-slate-500">
                      {lang === 'th' ? 'ค่าธรรมเนียม GP / แพลตฟอร์ม' : 'Platform Fees'}
                    </div>
                    <div className="text-base font-semibold text-slate-900">
                      ฿{formatMoney(summary.platformFeeTotal)}
                    </div>
                  </div>

                  <div className="py-3 border-b border-slate-200 space-y-1">
                    <div className="text-xs text-slate-500">
                      {lang === 'th' ? 'ยอดรวมที่ได้รับทั้งหมด' : 'Total Received'}
                    </div>
                    <div className="text-base font-bold text-emerald-700">
                      ฿{formatMoney(summary.totalReceived)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 6. SALES BY CATEGORY (ยอดขายตามประเภท) */}
            {activeReport === 'by_category' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'th' ? 'ยอดขายตามหมวดหมู่อาหาร' : 'Sales by Menu Category'}
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {categoryStats.length} {lang === 'th' ? 'หมวดหมู่' : 'categories'}
                  </span>
                </div>

                {categoryStats.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">{t.common.noData}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                          <th className="py-2.5 pr-4">{lang === 'th' ? 'หมวดหมู่' : 'Category'}</th>
                          <th className="py-2.5 px-4 text-center">{lang === 'th' ? 'จำนวนที่ขาย' : 'Qty Sold'}</th>
                          <th className="py-2.5 px-4 text-right">{lang === 'th' ? 'สัดส่วน' : 'Share'}</th>
                          <th className="py-2.5 pl-4 text-right">{lang === 'th' ? 'ยอดขาย' : 'Revenue'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {categoryStats.map((c) => (
                          <tr key={c.categoryId} className="hover:bg-slate-50/70">
                            <td className="py-3 pr-4 font-semibold text-slate-800">{c.categoryName}</td>
                            <td className="py-3 px-4 text-center text-slate-600">{c.quantity}</td>
                            <td className="py-3 px-4 text-right text-slate-500">
                              {c.sharePercent.toFixed(1)}%
                            </td>
                            <td className="py-3 pl-4 text-right font-bold text-slate-900">
                              ฿{formatMoney(c.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 7. BEST SELLING ITEMS (รายการขายดี) */}
            {activeReport === 'best_sellers' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'th' ? 'รายการอาหารขายดี' : 'Best Selling Menu Items'}
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {bestSellers.reduce((s, r) => s + r.quantity, 0)}{' '}
                    {lang === 'th' ? 'รายการ' : 'items sold'}
                  </span>
                </div>

                {bestSellers.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">{t.common.noData}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                          <th className="py-2.5 pr-3 w-10">#</th>
                          <th className="py-2.5 pr-4">{lang === 'th' ? 'ชื่อเมนู' : 'Menu Item'}</th>
                          <th className="py-2.5 px-4 text-center">{lang === 'th' ? 'จำนวน' : 'Qty'}</th>
                          <th className="py-2.5 px-4 text-right">{lang === 'th' ? 'สัดส่วน' : 'Share'}</th>
                          <th className="py-2.5 pl-4 text-right">{lang === 'th' ? 'ยอดขาย' : 'Revenue'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {bestSellers.map((item, idx) => (
                          <tr key={item.dishId || item.dishName} className="hover:bg-slate-50/70">
                            <td className="py-3 pr-3 text-slate-400 font-semibold">{idx + 1}</td>
                            <td className="py-3 pr-4">
                              <div className="font-semibold text-slate-800">{item.dishName}</div>
                              {item.variants.length > 0 && (
                                <div className="text-xs text-slate-500">
                                  {item.variants
                                    .map((v) => `${v.variantName} (${v.quantity})`)
                                    .join(' · ')}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center font-semibold text-slate-800">
                              {item.quantity}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-500">
                              {item.sharePercent.toFixed(1)}%
                            </td>
                            <td className="py-3 pl-4 text-right font-bold text-slate-900">
                              ฿{formatMoney(item.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 8. MODIFIERS / SUB-OPTIONS (เมนูย่อย) */}
            {activeReport === 'modifiers' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'th' ? 'รายงานเมนูย่อยและตัวเลือกเสริม' : 'Sub-Options & Modifiers Report'}
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {modifierStats.reduce((s, m) => s + m.quantity, 0)}{' '}
                    {lang === 'th' ? 'ครั้ง' : 'selected'}
                  </span>
                </div>

                {modifierStats.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">{t.common.noData}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                          <th className="py-2.5 pr-4">{lang === 'th' ? 'ตัวเลือกย่อย' : 'Option Choice'}</th>
                          <th className="py-2.5 px-4">{lang === 'th' ? 'กลุ่มตัวเลือก' : 'Group'}</th>
                          <th className="py-2.5 px-4 text-center">{lang === 'th' ? 'จำนวน' : 'Qty'}</th>
                          <th className="py-2.5 pl-4 text-right">{lang === 'th' ? 'ยอดเพิ่ม' : 'Extra Revenue'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {modifierStats.map((m) => (
                          <tr key={m.key} className="hover:bg-slate-50/70">
                            <td className="py-3 pr-4 font-semibold text-slate-800">{m.choiceName}</td>
                            <td className="py-3 px-4 text-slate-500">{m.groupName || '-'}</td>
                            <td className="py-3 px-4 text-center font-semibold text-slate-800">
                              {m.quantity}
                            </td>
                            <td className="py-3 pl-4 text-right font-bold text-slate-900">
                              ฿{formatMoney(m.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 9. DISCOUNTS USED (ส่วนลดที่ถูกใช้) */}
            {activeReport === 'discounts' && (
              <div className="space-y-5">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-2.5">
                  {lang === 'th' ? 'สรุปส่วนลดที่ถูกใช้' : 'Discounts Used'}
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 tabular-nums">
                  <div className="py-2.5 border-b border-slate-200">
                    <div className="text-xs text-slate-500">
                      {lang === 'th' ? 'มูลค่าส่วนลดทั้งหมด' : 'Total Discount'}
                    </div>
                    <div className="text-base font-bold text-rose-600 mt-0.5">
                      ฿{formatMoney(discountsReport.totalDiscount)}
                    </div>
                  </div>
                  <div className="py-2.5 border-b border-slate-200">
                    <div className="text-xs text-slate-500">
                      {lang === 'th' ? 'จำนวนบิลที่ใช้ส่วนลด' : 'Discounted Bills'}
                    </div>
                    <div className="text-base font-bold text-slate-900 mt-0.5">
                      {discountsReport.discountedBillCount}
                    </div>
                  </div>
                  <div className="py-2.5 border-b border-slate-200">
                    <div className="text-xs text-slate-500">
                      {lang === 'th' ? 'แต้มสมาชิกที่ใช้แลก' : 'Points Redeemed'}
                    </div>
                    <div className="text-base font-bold text-slate-900 mt-0.5">
                      {discountsReport.totalPointsRedeemed}
                    </div>
                  </div>
                </div>

                {discountsReport.bills.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">{t.common.noData}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                          <th className="py-2.5 pr-4">{t.bills.billNo}</th>
                          <th className="py-2.5 px-4">{lang === 'th' ? 'ช่องทาง / โต๊ะ' : 'Channel / Table'}</th>
                          <th className="py-2.5 px-4 text-right">{t.pos.subtotal}</th>
                          <th className="py-2.5 px-4 text-right">{t.pos.discount}</th>
                          <th className="py-2.5 pl-4 text-right">{t.common.total}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {discountsReport.bills.map((bill) => (
                          <tr
                            key={bill.id}
                            onClick={() => setSelectedBillForDetails(bill)}
                            className="hover:bg-slate-50/80 cursor-pointer"
                          >
                            <td className="py-3 pr-4 font-mono font-semibold text-slate-900">
                              {bill.billNumber}
                            </td>
                            <td className="py-3 px-4 text-slate-600">
                              {bill.tableName || bill.channelName}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-600">
                              ฿{formatMoney(bill.subtotal)}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-rose-600">
                              -฿{formatMoney(bill.discountAmount)}
                            </td>
                            <td className="py-3 pl-4 text-right font-bold text-slate-900">
                              ฿{formatMoney(bill.grandTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 10. ALL BILLS & RECEIPTS (รายการบิลทั้งหมด - Full Existing Bill Table + Void/Reprint/Address) */}
            {activeReport === 'bill_list' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    {[
                      { id: 'all', label: t.common.all },
                      { id: 'saved', label: lang === 'th' ? 'ค้างชำระ / พักบิล' : 'Saved / Unpaid' },
                      { id: 'paid', label: t.bills.statusPaid },
                      { id: 'voided', label: t.bills.statusVoided },
                    ].map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setStatusFilter(st.id as BillStatus | 'all')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                          statusFilter === st.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-60">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={billSearch}
                      onChange={(e) => setBillSearch(e.target.value)}
                      placeholder={
                        lang === 'th' ? 'ค้นหาเลขบิล, โต๊ะ, ลูกค้า...' : 'Search bill #, table, customer...'
                      }
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="border-b border-slate-200 text-slate-500 font-semibold">
                      <tr>
                        <th className="py-2.5 pr-3">{t.bills.billNo}</th>
                        <th className="py-2.5 px-3">{t.bills.time} / {t.common.date}</th>
                        <th className="py-2.5 px-3">{t.bills.table}</th>
                        <th className="py-2.5 px-3">{lang === 'th' ? 'ช่องทาง' : 'Channel'}</th>
                        <th className="py-2.5 px-3">{t.common.status}</th>
                        <th className="py-2.5 px-3 text-right">{t.common.total}</th>
                        <th className="py-2.5 pl-3 text-right">{t.common.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {isLoading ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-500">
                            {t.common.loading}
                          </td>
                        </tr>
                      ) : paginatedBills.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-400">
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
                              className={`hover:bg-slate-50/70 ${isVoided ? 'bg-rose-50/40 opacity-75' : ''}`}
                            >
                              <td className="py-2.5 pr-3 font-mono font-bold text-slate-900">
                                {bill.billNumber || (lang === 'th' ? 'ยังไม่บันทึก' : 'Unsaved')}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                <div>{bill.workDate}</div>
                                <div className="text-[11px] text-slate-400">
                                  {new Date(bill.createdAt).toLocaleTimeString(
                                    lang === 'th' ? 'th-TH' : 'en-US',
                                    { hour: '2-digit', minute: '2-digit' }
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-slate-800">
                                <div>
                                  {bill.tableName ||
                                    bill.tableId ||
                                    (bill.orderType === 'delivery' ? 'Delivery' : t.pos.takeaway)}
                                </div>
                                {bill.customerName && (
                                  <div className="text-[11px] font-normal text-orange-700 truncate max-w-[160px]">
                                    {bill.customerName}
                                    {bill.customerPhone ? ` (${bill.customerPhone})` : ''}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">{bill.channelName}</td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`text-xs font-bold ${
                                    isPaid
                                      ? 'text-emerald-700'
                                      : isVoided
                                      ? 'text-rose-600'
                                      : 'text-amber-700'
                                  }`}
                                >
                                  {isPaid
                                    ? t.bills.statusPaid
                                    : isVoided
                                    ? t.bills.statusVoided
                                    : t.bills.statusSaved}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-sm text-slate-900 whitespace-nowrap">
                                ฿{formatMoney(bill.grandTotal)}
                              </td>
                              <td className="py-2.5 pl-3 text-right whitespace-nowrap space-x-1">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBillForDetails(bill)}
                                  className="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
                                  title={t.common.view}
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setReceiptBillToView(bill)}
                                  className="p-1.5 text-slate-600 hover:text-orange-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                                  title={t.bills.reprintReceipt}
                                >
                                  <Printer className="w-4 h-4" />
                                </button>
                                {(bill.deliveryAddress || bill.customerName || bill.customerPhone) && (
                                  <button
                                    type="button"
                                    onClick={() => setAddressBillToPrint(bill)}
                                    className="p-1.5 text-orange-600 hover:text-orange-700 rounded-lg hover:bg-orange-50 cursor-pointer"
                                    title={lang === 'th' ? 'พิมพ์ที่อยู่ลูกค้า' : 'Print Customer Address'}
                                  >
                                    <MapPin className="w-4 h-4" />
                                  </button>
                                )}
                                {!isVoided && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBillToVoid(bill);
                                      setVoidReason('');
                                      setIsVoidModalOpen(true);
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
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

                {/* Pagination */}
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    {lang === 'th'
                      ? `หน้า ${page} จาก ${totalPages} (ทั้งหมด ${filteredBillList.length} บิล)`
                      : `Page ${page} of ${totalPages} (${filteredBillList.length} total bills)`}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 disabled:opacity-40 cursor-pointer hover:bg-slate-100"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage(page + 1)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 disabled:opacity-40 cursor-pointer hover:bg-slate-100"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Bill Details Dialog */}
      {selectedBillForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <div className="modal-panel bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-orange-200">
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base">
                  {t.bills.billDetails} - {selectedBillForDetails.billNumber}
                </h3>
                <p className="text-xs text-orange-100">
                  {selectedBillForDetails.workDate} ·{' '}
                  {selectedBillForDetails.tableName ||
                    (selectedBillForDetails.orderType === 'delivery' ? 'Delivery' : t.pos.takeaway)}
                </p>
              </div>
              <button
                type="button"
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
                  type="button"
                  onClick={() => setAddressBillToPrint(selectedBillForDetails)}
                  className="px-4 py-2 bg-orange-50 text-orange-800 border border-orange-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-orange-100"
                >
                  <MapPin className="w-4 h-4 text-orange-600" />
                  <span>{lang === 'th' ? 'พิมพ์ที่อยู่ลูกค้า' : 'Print Address'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setReceiptBillToView(selectedBillForDetails)}
                className="px-4 py-2 bg-white text-neutral-800 border border-neutral-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>{t.bills.reprintReceipt}</span>
              </button>
              <button
                type="button"
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
                type="button"
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

      {/* Print Thermal Sales Summary Slip Modal */}
      {isSummaryPrintOpen && (
        <SalesSummaryPrintModal
          summary={summary}
          paymentStats={paymentStats}
          dateDisplayLabel={dateDisplayLabel}
          channelFilter={channelFilter}
          settings={settings}
          lang={lang}
          onClose={() => setIsSummaryPrintOpen(false)}
        />
      )}
    </div>
  );
};
