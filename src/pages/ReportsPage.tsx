import React, { useState, useEffect } from 'react';
import {
  DailySummaryDoc,
  ExpenseDoc,
  EmployeeDoc,
  SettingsDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import {
  formatMoney,
  formatPercent,
  roundTo2,
  calculateEmployeeMonthlyCost,
  getBusinessWorkDate,
} from '../engine/calculations';
import { fetchDailySummariesInRange, fetchCollection } from '../data/db';
import {
  BarChart3,
  Calendar,
  Printer,
  Download,
  TrendingUp,
  Percent,
  CircleDollarSign,
  PieChart,
  ShoppingBag,
  Award,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
}

type PeriodType = 'day' | 'month' | 'year';

export const ReportsPage: React.FC<Props> = ({ settings, lang }) => {
  const t = translations[lang];
  const [period, setPeriod] = useState<PeriodType>('month');

  const todayStr = getBusinessWorkDate(new Date(), settings.dailyClosingTime);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedMonth, setSelectedMonth] = useState<string>(todayStr.substring(0, 7)); // YYYY-MM
  const [selectedYear, setSelectedYear] = useState<string>(todayStr.substring(0, 4)); // YYYY

  // Data loaded ONLY from dailySummaries, expenses, and employees
  const [summaries, setSummaries] = useState<DailySummaryDoc[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
  const [employees, setEmployees] = useState<EmployeeDoc[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadReportData = async () => {
    setIsLoading(true);
    let startDate = selectedDate;
    let endDate = selectedDate;

    if (period === 'month') {
      startDate = `${selectedMonth}-01`;
      endDate = `${selectedMonth}-31`;
    } else if (period === 'year') {
      startDate = `${selectedYear}-01-01`;
      endDate = `${selectedYear}-12-31`;
    }

    try {
      const [sums, exps, emps] = await Promise.all([
        fetchDailySummariesInRange(startDate, endDate),
        fetchCollection<ExpenseDoc>('expenses'),
        fetchCollection<EmployeeDoc>('employees'),
      ]);
      setSummaries(sums);
      setExpenses(exps);
      setEmployees(emps);
    } catch (err) {
      console.error('Error loading report:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReportData();
  }, [period, selectedDate, selectedMonth, selectedYear]);

  // Aggregate values across fetched daily summaries
  let totalNetSales = 0;
  let totalGrossSales = 0;
  let totalDiscounts = 0;
  let totalFoodCost = 0;
  let totalPlatformFees = 0;
  let totalPackagingCost = 0;
  let totalOrdersCount = 0;
  const paymentMethodTotals: Record<string, number> = { cash: 0, qr: 0, card: 0, transfer: 0 };
  const channelSales: Record<string, { orderCount: number; netSales: number }> = {};
  const dishAggregates: Record<string, { name: string; quantity: number; revenue: number; cost: number }> = {};

  for (const s of summaries) {
    totalNetSales += s.netSales || 0;
    totalGrossSales += s.grossSales || 0;
    totalDiscounts += s.discounts || 0;
    totalFoodCost += s.totalFoodCost || 0;
    totalPlatformFees += s.platformFees || 0;
    totalPackagingCost += s.packagingCost || 0;
    totalOrdersCount += s.orderCount || 0;

    // Payment totals
    if (s.paymentTotals) {
      for (const [m, amt] of Object.entries(s.paymentTotals)) {
        paymentMethodTotals[m] = (paymentMethodTotals[m] || 0) + amt;
      }
    }

    // Channel totals
    if (s.channelTotals) {
      for (const [ch, stat] of Object.entries(s.channelTotals)) {
        if (!channelSales[ch]) channelSales[ch] = { orderCount: 0, netSales: 0 };
        channelSales[ch].orderCount += stat.orderCount;
        channelSales[ch].netSales += stat.netSales;
      }
    }

    // Dish Stats
    if (s.dishStats) {
      for (const [id, dStat] of Object.entries(s.dishStats)) {
        if (!dishAggregates[id]) {
          dishAggregates[id] = { name: dStat.dishName, quantity: 0, revenue: 0, cost: 0 };
        }
        dishAggregates[id].quantity += dStat.quantity;
        dishAggregates[id].revenue += dStat.revenue;
        dishAggregates[id].cost += dStat.cost;
      }
    }
  }

  // Calculate expenses & labor proportionate to period
  const monthlyFixedExpenses = expenses
    .filter((e) => e.isFixed || e.isRecurring)
    .reduce((sum, e) => sum + e.amount, 0);

  const monthlyLabor = employees.reduce(
    (sum, emp) => sum + calculateEmployeeMonthlyCost(emp),
    0
  );

  let allocatedExpenses = monthlyFixedExpenses;
  let allocatedLabor = monthlyLabor;

  if (period === 'day') {
    allocatedExpenses = roundTo2(monthlyFixedExpenses / 30);
    allocatedLabor = roundTo2(monthlyLabor / 30);
  } else if (period === 'year') {
    allocatedExpenses = roundTo2(monthlyFixedExpenses * 12);
    allocatedLabor = roundTo2(monthlyLabor * 12);
  }

  // Financial calculations
  const grossProfit = roundTo2(totalNetSales - totalFoodCost - totalPlatformFees - totalPackagingCost);
  const netOperatingProfit = roundTo2(grossProfit - allocatedExpenses - allocatedLabor);
  const foodCostPercent = totalNetSales > 0 ? (totalFoodCost / totalNetSales) * 100 : 0;
  const grossProfitMargin = totalNetSales > 0 ? (grossProfit / totalNetSales) * 100 : 0;
  const netProfitMargin = totalNetSales > 0 ? (netOperatingProfit / totalNetSales) * 100 : 0;
  const avgOrderValue = totalOrdersCount > 0 ? roundTo2(totalNetSales / totalOrdersCount) : 0;

  // Best sellers list (sorted by quantity)
  const bestSellers = Object.values(dishAggregates).sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  // Margin calculation per dish
  const dishesWithMargin = Object.values(dishAggregates)
    .filter((d) => d.revenue > 0)
    .map((d) => {
      const marginPct = ((d.revenue - d.cost) / d.revenue) * 100;
      return { ...d, marginPct };
    });

  const bestMarginDishes = [...dishesWithMargin].sort((a, b) => b.marginPct - a.marginPct).slice(0, 5);
  const worstMarginDishes = [...dishesWithMargin].sort((a, b) => a.marginPct - b.marginPct).slice(0, 5);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    const rows = [
      ['Metric', 'Amount (THB)'],
      ['Net Sales', totalNetSales.toFixed(2)],
      ['Discounts', totalDiscounts.toFixed(2)],
      ['Food Cost', totalFoodCost.toFixed(2)],
      ['Food Cost %', `${foodCostPercent.toFixed(1)}%`],
      ['Platform Commissions', totalPlatformFees.toFixed(2)],
      ['Packaging Cost', totalPackagingCost.toFixed(2)],
      ['Gross Profit', grossProfit.toFixed(2)],
      ['Allocated Expenses', allocatedExpenses.toFixed(2)],
      ['Allocated Labor', allocatedLabor.toFixed(2)],
      ['Net Operating Profit', netOperatingProfit.toFixed(2)],
      ['Total Orders', totalOrdersCount.toString()],
      ['Average Order Value', avgOrderValue.toFixed(2)],
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `P_and_L_Report_${period}_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 select-none">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-red-600" />
            <span>{t.reports.title}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Read directly from daily summaries, expenses and labor. High performance, zero bills scanning.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="px-3 py-1.5 bg-white text-neutral-700 hover:bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Download className="w-3.5 h-3.5 text-orange-600" />
            <span>{t.reports.exportCsv}</span>
          </button>
          <button
            onClick={handlePrint}
            className="px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 cursor-pointer hover:brightness-105"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t.reports.printReport}</span>
          </button>
        </div>
      </div>

      {/* Period Selector Bar */}
      <div className="p-3 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPeriod('day')}
            className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-all ${
              period === 'day'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {t.reports.periodDay}
          </button>
          <button
            onClick={() => setPeriod('month')}
            className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-all ${
              period === 'month'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {t.reports.periodMonth}
          </button>
          <button
            onClick={() => setPeriod('year')}
            className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-all ${
              period === 'year'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {t.reports.periodYear}
          </button>
        </div>

        {/* Date / Month / Year Picker */}
        <div className="flex items-center gap-2">
          {period === 'day' && (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-2.5 py-1 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
            />
          )}
          {period === 'month' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-2.5 py-1 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
            />
          )}
          {period === 'year' && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-2.5 py-1 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y.toString()}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Primary Financial Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.reports.netSales}</div>
          <div className="text-xl font-black text-neutral-900 mt-1">฿{formatMoney(totalNetSales)}</div>
          <div className="text-[10px] text-neutral-400 mt-0.5">{totalOrdersCount} orders (avg ฿{formatMoney(avgOrderValue)})</div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.reports.foodCost}</div>
          <div className="text-xl font-black text-neutral-900 mt-1">฿{formatMoney(totalFoodCost)}</div>
          <div className={`text-[11px] font-extrabold mt-0.5 ${foodCostPercent > settings.targetFoodCostPercent ? 'text-rose-600' : 'text-emerald-700'}`}>
            {formatPercent(foodCostPercent)} of Net Sales
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.reports.grossProfit}</div>
          <div className="text-xl font-black text-neutral-900 mt-1">฿{formatMoney(grossProfit)}</div>
          <div className="text-[11px] font-bold text-neutral-600 mt-0.5">
            Margin: {formatPercent(grossProfitMargin)}
          </div>
        </div>

        <div className={`p-4 rounded-2xl border shadow-xs ${netOperatingProfit >= 0 ? 'bg-emerald-50/50 border-emerald-300' : 'bg-rose-50/50 border-rose-300'}`}>
          <div className="text-[11px] font-bold text-neutral-600">{t.reports.netOperatingProfit}</div>
          <div className={`text-xl font-black mt-1 ${netOperatingProfit >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
            ฿{formatMoney(netOperatingProfit)}
          </div>
          <div className="text-[11px] font-bold text-neutral-600 mt-0.5">
            Net Margin: {formatPercent(netProfitMargin)}
          </div>
        </div>
      </div>

      {/* P&L Statement Card */}
      <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
        <h3 className="font-black text-base text-neutral-900 flex items-center gap-2">
          <CircleDollarSign className="w-5 h-5 text-emerald-600" />
          <span>{t.reports.pnlStatement}</span>
        </h3>

        <div className="divide-y divide-neutral-100 text-xs font-semibold">
          <div className="py-2 flex justify-between text-neutral-800">
            <span>{t.reports.netSales}</span>
            <span className="font-bold">฿{formatMoney(totalNetSales)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>- {t.reports.foodCost}</span>
            <span>-฿{formatMoney(totalFoodCost)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>- {t.reports.platformFees}</span>
            <span>-฿{formatMoney(totalPlatformFees)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>- {t.reports.packagingCost}</span>
            <span>-฿{formatMoney(totalPackagingCost)}</span>
          </div>
          <div className="py-2 flex justify-between font-bold text-neutral-900 bg-neutral-50 px-2 rounded-lg">
            <span>= {t.reports.grossProfit}</span>
            <span>฿{formatMoney(grossProfit)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>- {t.reports.operatingExpenses}</span>
            <span>-฿{formatMoney(allocatedExpenses)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>- {t.reports.laborCost}</span>
            <span>-฿{formatMoney(allocatedLabor)}</span>
          </div>
          <div className="py-2.5 flex justify-between font-black text-sm text-neutral-900 bg-orange-50 px-2 rounded-lg">
            <span>= {t.reports.netOperatingProfit}</span>
            <span className={netOperatingProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
              ฿{formatMoney(netOperatingProfit)}
            </span>
          </div>
        </div>
      </div>

      {/* Best Sellers & Margin Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top Sellers */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-3">
          <h4 className="font-black text-xs text-neutral-800 uppercase flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-500" />
            <span>{t.reports.topBestSellers}</span>
          </h4>
          <div className="space-y-2 text-xs">
            {bestSellers.length === 0 ? (
              <div className="text-neutral-400 py-4 text-center">{t.common.noData}</div>
            ) : (
              bestSellers.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center p-2 bg-neutral-50 rounded-xl">
                  <span className="font-bold text-neutral-800 truncate pr-2">
                    #{idx + 1} {item.name}
                  </span>
                  <span className="font-black text-orange-600 whitespace-nowrap">
                    {item.quantity} orders
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Best Margin Dishes */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-3">
          <h4 className="font-black text-xs text-neutral-800 uppercase flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span>{t.reports.bestMarginDishes}</span>
          </h4>
          <div className="space-y-2 text-xs">
            {bestMarginDishes.length === 0 ? (
              <div className="text-neutral-400 py-4 text-center">{t.common.noData}</div>
            ) : (
              bestMarginDishes.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center p-2 bg-emerald-50/50 rounded-xl">
                  <span className="font-bold text-neutral-800 truncate pr-2">{item.name}</span>
                  <span className="font-black text-emerald-700 whitespace-nowrap">
                    {formatPercent(item.marginPct)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Worst Margin Dishes (Needs Attention) */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-3">
          <h4 className="font-black text-xs text-neutral-800 uppercase flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>{t.reports.worstMarginDishes}</span>
          </h4>
          <div className="space-y-2 text-xs">
            {worstMarginDishes.length === 0 ? (
              <div className="text-neutral-400 py-4 text-center">{t.common.noData}</div>
            ) : (
              worstMarginDishes.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center p-2 bg-rose-50/50 rounded-xl">
                  <span className="font-bold text-neutral-800 truncate pr-2">{item.name}</span>
                  <span className="font-black text-rose-700 whitespace-nowrap">
                    {formatPercent(item.marginPct)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Breakdown by Payment Method & Sales Channel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Payment Methods */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-2 text-xs">
          <h4 className="font-black text-xs text-neutral-800 uppercase">
            {t.reports.salesByPayment}
          </h4>
          <div className="space-y-1.5">
            {Object.entries(paymentMethodTotals).map(([method, amount]) => (
              <div key={method} className="flex justify-between p-2 bg-neutral-50 rounded-xl">
                <span className="capitalize font-bold text-neutral-700">{method}</span>
                <span className="font-black text-neutral-900">฿{formatMoney(amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sales Channel */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-2 text-xs">
          <h4 className="font-black text-xs text-neutral-800 uppercase">
            {t.reports.salesByChannel}
          </h4>
          <div className="space-y-1.5">
            {Object.keys(channelSales).length === 0 ? (
              <div className="text-neutral-400 py-3 text-center">{t.common.noData}</div>
            ) : (
              Object.entries(channelSales).map(([ch, stat]) => (
                <div key={ch} className="flex justify-between p-2 bg-neutral-50 rounded-xl">
                  <span className="capitalize font-bold text-neutral-700">
                    {ch} ({stat.orderCount} orders)
                  </span>
                  <span className="font-black text-neutral-900">฿{formatMoney(stat.netSales)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
