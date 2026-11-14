import React, { useState, useEffect } from 'react';
import {
  DailySummaryDoc,
  DishDoc,
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
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
  calculateDishVariantCost,
  calculateFoodCostPercent,
  extractNetPriceFromMenuPrice,
  calculatePeriodExpensesAndLabor,
  calculateUsaliPnl,
} from '../engine/calculations';
import { subscribeSingleDailySummary, subscribeCollection } from '../data/db';
import { AppPage } from '../components/Navigation';
import {
  LayoutDashboard,
  AlertTriangle,
  ArrowRight,
  Flame,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
  onNavigate: (page: AppPage) => void;
}

export const DashboardPage: React.FC<Props> = ({ settings, lang, onNavigate }) => {
  const t = translations[lang];
  const todayStr = getBusinessWorkDate(new Date(), settings.dailyClosingTime);

  const [todaySummary, setTodaySummary] = useState<DailySummaryDoc | null>(null);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [ingredients, setIngredients] = useState<IngredientDoc[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipeDoc[]>([]);
  const [packagings, setPackagings] = useState<PackagingDoc[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
  const [employees, setEmployees] = useState<EmployeeDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    const unsubSummary = subscribeSingleDailySummary(
      todayStr,
      (sum) => {
        setTodaySummary(sum);
        setIsLoading(false);
      },
      (err) => {
        console.error('Dashboard summary listener error:', err);
        setIsLoading(false);
      }
    );
    const unsubDishes = subscribeCollection<DishDoc>('dishes', (d) => setDishes(d));
    const unsubIngredients = subscribeCollection<IngredientDoc>('ingredients', (i) => setIngredients(i));
    const unsubSubs = subscribeCollection<SubRecipeDoc>('subRecipes', (s) => setSubRecipes(s));
    const unsubPkgs = subscribeCollection<PackagingDoc>('packaging', (p) => setPackagings(p));
    const unsubExps = subscribeCollection<ExpenseDoc>('expenses', (e) => setExpenses(e));
    const unsubEmps = subscribeCollection<EmployeeDoc>('employees', (emp) => setEmployees(emp));

    return () => {
      unsubSummary();
      unsubDishes();
      unsubIngredients();
      unsubSubs();
      unsubPkgs();
      unsubExps();
      unsubEmps();
    };
  }, [todayStr]);

  // Maps for costing checks
  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));
  const subRecipesMap = new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s]));
  const packagingMap = new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p]));

  // Audit warnings: dishes with no recipe, missing ingredient cost, or food cost % > target (Food COGS only)
  const dishesWithoutRecipe: DishDoc[] = [];
  const dishesAboveTarget: { dish: DishDoc; costPct: number; hasMissing: boolean }[] = [];
  const dishesWithMissingCost: DishDoc[] = [];

  for (const dish of dishes) {
    const primary = dish.variants[0];
    if (!primary) {
      dishesWithoutRecipe.push(dish);
      continue;
    }
    const costCalc = calculateDishVariantCost(primary, ingredientsMap, subRecipesMap, packagingMap);
    if (!costCalc.hasRecipe) {
      dishesWithoutRecipe.push(dish);
    } else {
      if (costCalc.hasMissing) {
        dishesWithMissingCost.push(dish);
      }
      // Strictly compare Food COGS (excluding packaging) against net selling price
      const netVariantPrice = extractNetPriceFromMenuPrice(
        primary.price,
        settings.pricesIncludeVat,
        settings.vatPercent,
        settings.serviceChargeIncludedInPrice,
        settings.serviceChargePercent
      );
      const pct = calculateFoodCostPercent(costCalc.foodCost, netVariantPrice);
      if (pct > settings.targetFoodCostPercent) {
        dishesAboveTarget.push({ dish, costPct: pct, hasMissing: costCalc.hasMissing });
      }
    }
  }

  // Today's top dishes
  const todayTopDishes = todaySummary?.dishStats
    ? Object.values(todaySummary.dishStats).sort((a, b) => b.quantity - a.quantity).slice(0, 5)
    : [];

  // Centralized USALI P&L for today
  const todaySummaries = todaySummary ? [todaySummary] : [];
  const todayCosts = calculatePeriodExpensesAndLabor('day', todayStr, expenses, employees, todaySummaries);
  const todayPnl = calculateUsaliPnl(
    todaySummaries,
    todayCosts,
    settings.serviceChargeTreatment || 'staff_pool'
  );

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 select-none">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-amber-600" />
            <span>{t.dashboard.title}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Work Date: <strong className="text-neutral-800">{todayStr}</strong> (Cutoff: {settings.dailyClosingTime})
            {isLoading ? ` • ${t.common.loading}` : ''}
          </p>
        </div>

        {/* Quick Navigate to POS */}
        <button
          onClick={() => onNavigate('pos')}
          className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105 active:scale-95"
        >
          <span>Open POS Register</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.dashboard.todaySales}</div>
          <div className="text-xl font-black text-neutral-900 mt-1">
            ฿{formatMoney(todayPnl.netSales)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">
            {todayPnl.orderCount} {t.dashboard.todayOrders}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.reports.foodCostPct}</div>
          <div
            className={`text-xl font-black mt-1 ${
              todayPnl.theoreticalFoodCostPercent > settings.targetFoodCostPercent ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {formatPercent(todayPnl.theoreticalFoodCostPercent)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">Target: {settings.targetFoodCostPercent}%</div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.reports.grossProfit}</div>
          <div className="text-xl font-black text-neutral-900 mt-1">
            ฿{formatMoney(todayPnl.grossProfit)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">
            Food COGS: ฿{formatMoney(todayPnl.totalFoodCost)} ({formatPercent(todayPnl.grossProfitMarginPercent)})
          </div>
        </div>

        <div
          className={`p-4 rounded-2xl border shadow-xs ${
            todayPnl.netOperatingProfit >= 0 ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50/60 border-rose-200'
          }`}
        >
          <div className="text-[11px] font-bold text-neutral-700">{t.dashboard.todayNetProfit}</div>
          <div
            className={`text-xl font-black mt-1 ${
              todayPnl.netOperatingProfit >= 0 ? 'text-emerald-950' : 'text-rose-900'
            }`}
          >
            ฿{formatMoney(todayPnl.netOperatingProfit)}
          </div>
          <div className="text-[10px] text-neutral-600 mt-0.5">
            USALI NOP (OpEx &amp; Labor allocated/day)
          </div>
        </div>
      </div>

      {/* Missing Ingredient Cost Banner if any */}
      {dishesWithMissingCost.length > 0 && (
        <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-rose-800 font-bold">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>
              {t.menuCost.missingCost}: {dishesWithMissingCost.map((d) => d.name).join(', ')}
            </span>
          </div>
          <button
            onClick={() => onNavigate('menu_cost')}
            className="text-xs font-black text-rose-700 hover:underline cursor-pointer"
          >
            {t.dashboard.fixRecipe} →
          </button>
        </div>
      )}

      {/* Critical Warnings Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Warning: Above Target Cost */}
        <div className="p-4 bg-white rounded-2xl border border-amber-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-black text-xs text-rose-700 uppercase flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>{t.dashboard.dishesAboveTarget} ({dishesAboveTarget.length})</span>
            </h4>
            <button
              onClick={() => onNavigate('menu_cost')}
              className="text-xs font-bold text-orange-600 hover:text-orange-700 cursor-pointer"
            >
              {t.dashboard.fixRecipe} →
            </button>
          </div>

          <div className="space-y-1.5 text-xs">
            {dishesAboveTarget.length === 0 ? (
              <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold text-center">
                All dishes are currently within target food cost!
              </div>
            ) : (
              dishesAboveTarget.map(({ dish, costPct }) => (
                <div key={dish.id} className="p-2.5 bg-rose-50/50 rounded-xl flex items-center justify-between">
                  <span className="font-bold text-neutral-900">{dish.name}</span>
                  <span className="font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md">
                    {formatPercent(costPct)} (Target {settings.targetFoodCostPercent}%)
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Warning: Dishes with No Recipe */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-black text-xs text-amber-700 uppercase flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>{t.dashboard.dishesWithoutRecipe} ({dishesWithoutRecipe.length})</span>
            </h4>
            <button
              onClick={() => onNavigate('menu_cost')}
              className="text-xs font-bold text-orange-600 hover:text-orange-700 cursor-pointer"
            >
              {t.dashboard.fixRecipe} →
            </button>
          </div>

          <div className="space-y-1.5 text-xs">
            {dishesWithoutRecipe.length === 0 ? (
              <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold text-center">
                All menu items have recipes linked!
              </div>
            ) : (
              dishesWithoutRecipe.map((dish) => (
                <div key={dish.id} className="p-2.5 bg-amber-50/50 rounded-xl flex items-center justify-between">
                  <span className="font-bold text-neutral-900">{dish.name}</span>
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                    {t.pos.noRecipeLinked}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Top Dishes Today */}
      <div className="p-4 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
        <h4 className="font-black text-sm text-neutral-900 flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-600" />
          <span>{t.dashboard.topSellersToday}</span>
        </h4>

        {todayTopDishes.length === 0 ? (
          <div className="p-8 text-center text-neutral-400 text-xs">{t.common.noData}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {todayTopDishes.map((dishStat, idx) => (
              <div
                key={idx}
                className="p-3 bg-neutral-50 rounded-2xl border border-neutral-100 flex items-center justify-between"
              >
                <div>
                  <span className="text-[10px] font-bold text-neutral-400 uppercase">#{idx + 1}</span>
                  <div className="font-bold text-xs text-neutral-900">{dishStat.dishName}</div>
                </div>
                <div className="text-right">
                  <div className="font-black text-xs text-orange-600">
                    {dishStat.quantity} orders
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    ฿{formatMoney(dishStat.revenue)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
