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
  getBusinessWorkDate,
  getMonthDateRange,
  calculatePeriodExpensesAndLabor,
  calculateUsaliPnl,
  BenchmarkStatus,
} from '../engine/calculations';
import { fetchDailySummariesInRange, fetchCollection } from '../data/db';
import {
  BarChart3,
  Printer,
  Download,
  TrendingUp,
  CircleDollarSign,
  Award,
  AlertTriangle,
  Flame,
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
      const range = getMonthDateRange(selectedMonth);
      startDate = range.startDate;
      endDate = range.endDate;
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

  // Aggregate payment/channel/dish breakdown across fetched daily summaries
  const paymentMethodTotals: Record<string, number> = { cash: 0, qr: 0, card: 0, transfer: 0 };
  const channelSales: Record<string, { orderCount: number; netSales: number }> = {};
  const dishAggregates: Record<string, { name: string; quantity: number; revenue: number; cost: number }> = {};

  for (const s of summaries) {
    if (s.paymentTotals) {
      for (const [m, amt] of Object.entries(s.paymentTotals)) {
        paymentMethodTotals[m] = (paymentMethodTotals[m] || 0) + amt;
      }
    }

    if (s.channelTotals) {
      for (const [ch, stat] of Object.entries(s.channelTotals)) {
        if (!channelSales[ch]) channelSales[ch] = { orderCount: 0, netSales: 0 };
        channelSales[ch].orderCount += stat.orderCount;
        channelSales[ch].netSales += stat.netSales;
      }
    }

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

  // Centralized date-filtered expense & labor allocation + USALI P&L
  const dateParam = period === 'day' ? selectedDate : period === 'month' ? selectedMonth : selectedYear;
  const allocatedPeriodCosts = calculatePeriodExpensesAndLabor(
    period,
    dateParam,
    expenses,
    employees,
    summaries
  );

  const pnl = calculateUsaliPnl(
    summaries,
    allocatedPeriodCosts,
    settings.serviceChargeTreatment || 'staff_pool'
  );

  const getBadgeStyle = (status: BenchmarkStatus) => {
    if (status === 'good') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (status === 'warning') return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-rose-100 text-rose-800 border-rose-200';
  };

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
      ['Net Sales Revenue', pnl.netSales.toFixed(2)],
      ...(settings.serviceChargeTreatment === 'retained'
        ? [['Other Revenue (Retained Service Charge)', pnl.retainedServiceCharge.toFixed(2)]]
        : []),
      ['Total P&L Revenue', pnl.totalRevenue.toFixed(2)],
      ['Discounts', pnl.discounts.toFixed(2)],
      ['Food COGS', pnl.totalFoodCost.toFixed(2)],
      ['Theoretical Food Cost %', `${pnl.theoreticalFoodCostPercent.toFixed(1)}%`],
      ['Gross Profit', pnl.grossProfit.toFixed(2)],
      ['Gross Profit Margin %', `${pnl.grossProfitMarginPercent.toFixed(1)}%`],
      ['Packaging Cost', pnl.packagingCost.toFixed(2)],
      ['Platform Commissions', pnl.platformFees.toFixed(2)],
      ['Labor Cost', pnl.laborCost.toFixed(2)],
      ['Labor %', `${pnl.laborPercent.toFixed(1)}%`],
      ['Operating Expenses (Fixed + Variable)', pnl.operatingExpenses.toFixed(2)],
      ['Prime Cost (Food COGS + Labor)', pnl.primeCost.toFixed(2)],
      ['Prime Cost %', `${pnl.primeCostPercent.toFixed(1)}%`],
      ['Net Operating Profit (NOP)', pnl.netOperatingProfit.toFixed(2)],
      ['Net Profit Margin %', `${pnl.netProfitMarginPercent.toFixed(1)}%`],
      ['Total Orders', pnl.orderCount.toString()],
      ['Average Order Value', pnl.avgOrderValue.toFixed(2)],
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `USALI_PNL_${period}_${dateParam}.csv`);
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
            USALI-standard P&amp;L from daily summaries, date-filtered expenses &amp; labor ({pnl.daysInPeriod} days
            {period === 'year' ? ` • ${pnl.coveredMonths} mo` : ''}).
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
          <div className="text-xl font-black text-neutral-900 mt-1">฿{formatMoney(pnl.netSales)}</div>
          <div className="text-[10px] text-neutral-400 mt-0.5">
            {pnl.orderCount} orders (avg ฿{formatMoney(pnl.avgOrderValue)})
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.reports.foodCost}</div>
          <div className="text-xl font-black text-neutral-900 mt-1">฿{formatMoney(pnl.totalFoodCost)}</div>
          <div
            className={`text-[11px] font-extrabold mt-0.5 ${
              pnl.theoreticalFoodCostPercent > settings.targetFoodCostPercent ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {formatPercent(pnl.theoreticalFoodCostPercent)} ({t.reports.foodCostPct})
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.reports.grossProfit}</div>
          <div className="text-xl font-black text-neutral-900 mt-1">฿{formatMoney(pnl.grossProfit)}</div>
          <div className="text-[11px] font-bold text-neutral-600 mt-0.5">
            {t.reports.grossProfitMargin}: {formatPercent(pnl.grossProfitMarginPercent)}
          </div>
        </div>

        <div
          className={`p-4 rounded-2xl border shadow-xs ${
            pnl.netOperatingProfit >= 0 ? 'bg-emerald-50/50 border-emerald-300' : 'bg-rose-50/50 border-rose-300'
          }`}
        >
          <div className="text-[11px] font-bold text-neutral-600">{t.reports.netOperatingProfit}</div>
          <div className={`text-xl font-black mt-1 ${pnl.netOperatingProfit >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
            ฿{formatMoney(pnl.netOperatingProfit)}
          </div>
          <div className="text-[11px] font-bold text-neutral-600 mt-0.5">
            {t.reports.netProfitMargin}: {formatPercent(pnl.netProfitMarginPercent)}
          </div>
        </div>
      </div>

      {/* Prime Cost & Labor KPI Card */}
      <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div>
          <div className="text-xs font-black text-neutral-800 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-orange-600" />
            <span>{t.reports.primeCost}</span>
          </div>
          <div className="text-xl font-black text-neutral-900 mt-1">฿{formatMoney(pnl.primeCost)}</div>
          <div className="text-[11px] text-neutral-500">
            Food ฿{formatMoney(pnl.totalFoodCost)} + Labor ฿{formatMoney(pnl.laborCost)}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-neutral-500">{t.reports.primeCostPct}</div>
            <div className="text-lg font-black text-neutral-900">{formatPercent(pnl.primeCostPercent)}</div>
          </div>
          <span className={`text-[10px] font-extrabold px-2 py-1 rounded-lg border ${getBadgeStyle(pnl.primeCostStatus)}`}>
            {pnl.primeCostStatus === 'good'
              ? t.reports.primeCostStatusGood
              : pnl.primeCostStatus === 'warning'
              ? t.reports.primeCostStatusWarning
              : t.reports.primeCostStatusDanger}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-neutral-500">{t.reports.laborPct}</div>
            <div className="text-lg font-black text-neutral-900">{formatPercent(pnl.laborPercent)}</div>
          </div>
          <span className={`text-[10px] font-extrabold px-2 py-1 rounded-lg border ${getBadgeStyle(pnl.laborStatus)}`}>
            {pnl.laborStatus === 'good' ? 'Target ≤ 30%' : pnl.laborStatus === 'warning' ? '30% - 35%' : '> 35%'}
          </span>
        </div>
      </div>

      {/* USALI P&L Statement Card */}
      <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-black text-base text-neutral-900 flex items-center gap-2">
            <CircleDollarSign className="w-5 h-5 text-emerald-600" />
            <span>{t.reports.pnlStatement}</span>
          </h3>
          {isLoading && <span className="text-xs text-neutral-400">{t.common.loading}</span>}
        </div>

        <div className="divide-y divide-neutral-100 text-xs font-semibold">
          <div className="py-2 flex justify-between text-neutral-800">
            <span>{t.reports.netSales}</span>
            <span className="font-bold">฿{formatMoney(pnl.netSales)}</span>
          </div>

          {settings.serviceChargeTreatment === 'retained' ? (
            <div className="py-2 flex justify-between text-emerald-700 pl-3">
              <span>+ Other Revenue (Retained Service Charge)</span>
              <span>+฿{formatMoney(pnl.retainedServiceCharge)}</span>
            </div>
          ) : pnl.serviceChargeCollected > 0 ? (
            <div className="py-1.5 flex justify-between text-neutral-400 pl-3 text-[11px]">
              <span>Service Charge Collected (Pass-through / Staff Pool, excluded)</span>
              <span>฿{formatMoney(pnl.serviceChargeCollected)}</span>
            </div>
          ) : null}

          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>
              - {t.reports.foodCost} ({formatPercent(pnl.theoreticalFoodCostPercent)})
            </span>
            <span>-฿{formatMoney(pnl.totalFoodCost)}</span>
          </div>

          <div className="py-2 flex justify-between font-bold text-neutral-900 bg-neutral-50 px-2 rounded-lg">
            <span>
              = {t.reports.grossProfit} ({formatPercent(pnl.grossProfitMarginPercent)})
            </span>
            <span>฿{formatMoney(pnl.grossProfit)}</span>
          </div>

          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>- {t.reports.packagingCost}</span>
            <span>-฿{formatMoney(pnl.packagingCost)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>- {t.reports.platformFees}</span>
            <span>-฿{formatMoney(pnl.platformFees)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>
              - {t.reports.laborCost} ({formatPercent(pnl.laborPercent)})
            </span>
            <span>-฿{formatMoney(pnl.laborCost)}</span>
          </div>
          <div className="py-2 flex justify-between text-neutral-600 pl-3">
            <span>
              - {t.reports.operatingExpenses} (Fixed ฿{formatMoney(pnl.fixedExpenses)} + Var ฿{formatMoney(pnl.variableExpenses)})
            </span>
            <span>-฿{formatMoney(pnl.operatingExpenses)}</span>
          </div>
          <div className="py-2.5 flex justify-between font-black text-sm text-neutral-900 bg-orange-50 px-2 rounded-lg">
            <span>
              = {t.reports.netOperatingProfit} ({formatPercent(pnl.netProfitMarginPercent)})
            </span>
            <span className={pnl.netOperatingProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
              ฿{formatMoney(pnl.netOperatingProfit)}
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
