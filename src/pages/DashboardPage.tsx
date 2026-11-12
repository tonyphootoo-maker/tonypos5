import React, { useState, useEffect } from 'react';
import {
  DailySummaryDoc,
  DishDoc,
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
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
  roundTo2,
} from '../engine/calculations';
import { fetchSingleDailySummary, fetchCollection } from '../data/db';
import { AppPage } from '../components/Navigation';
import {
  LayoutDashboard,
  TrendingUp,
  AlertTriangle,
  Award,
  UtensilsCrossed,
  Receipt,
  CircleDollarSign,
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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [sum, dshs, ings, subs, pkgs] = await Promise.all([
          fetchSingleDailySummary(todayStr),
          fetchCollection<DishDoc>('dishes'),
          fetchCollection<IngredientDoc>('ingredients'),
          fetchCollection<SubRecipeDoc>('subRecipes'),
          fetchCollection<PackagingDoc>('packaging'),
        ]);
        setTodaySummary(sum);
        setDishes(dshs);
        setIngredients(ings);
        setSubRecipes(subs);
        setPackagings(pkgs);
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [todayStr]);

  // Maps for costing checks
  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));
  const subRecipesMap = new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s]));
  const packagingMap = new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p]));

  // Audit warnings: dishes with no recipe or food cost % > target
  const dishesWithoutRecipe: DishDoc[] = [];
  const dishesAboveTarget: { dish: DishDoc; costPct: number }[] = [];

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
      const pct = calculateFoodCostPercent(costCalc.totalCost, primary.price);
      if (pct > settings.targetFoodCostPercent) {
        dishesAboveTarget.push({ dish, costPct: pct });
      }
    }
  }

  // Today's top dishes
  const todayTopDishes = todaySummary?.dishStats
    ? Object.values(todaySummary.dishStats).sort((a, b) => b.quantity - a.quantity).slice(0, 5)
    : [];

  const todayNetSales = todaySummary?.netSales || 0;
  const todayFoodCost = todaySummary?.totalFoodCost || 0;
  const todayOrders = todaySummary?.orderCount || 0;
  const todayGrossProfit = roundTo2(
    todayNetSales - todayFoodCost - (todaySummary?.platformFees || 0) - (todaySummary?.packagingCost || 0)
  );
  const todayFoodCostPct = todayNetSales > 0 ? (todayFoodCost / todayNetSales) * 100 : 0;

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
            ฿{formatMoney(todayNetSales)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">{todayOrders} {t.dashboard.todayOrders}</div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">{t.dashboard.todayFoodCostPct}</div>
          <div className={`text-xl font-black mt-1 ${todayFoodCostPct > settings.targetFoodCostPercent ? 'text-rose-600' : 'text-emerald-700'}`}>
            {formatPercent(todayFoodCostPct)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">Target: {settings.targetFoodCostPercent}%</div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs">
          <div className="text-[11px] font-bold text-neutral-500">Today's Food Cost</div>
          <div className="text-xl font-black text-neutral-900 mt-1">
            ฿{formatMoney(todayFoodCost)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">Live ingredient snapshots</div>
        </div>

        <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200 shadow-xs">
          <div className="text-[11px] font-bold text-emerald-800">{t.dashboard.todayNetProfit}</div>
          <div className="text-xl font-black text-emerald-950 mt-1">
            ฿{formatMoney(todayGrossProfit)}
          </div>
          <div className="text-[10px] text-emerald-700 mt-0.5">Gross Profit</div>
        </div>
      </div>

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
