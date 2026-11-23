import {
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
  DishVariant,
  OptionChoice,
  OrderItem,
  ChannelDoc,
  EmployeeDoc,
  SettingsDoc,
  DailySummaryDoc,
  ExpenseDoc,
} from '../types';
import { DailySalesRecord } from '../costing/types/domain';
import {
  StockCountSnapshot,
  PurchaseRecord,
  WasteRecord,
  SaleOrder,
  Ingredient,
} from '../costing/types';
import { calculateVariance } from '../costing/engine/calculations';

/**
 * Rounds a number strictly to 2 decimal places.
 */
export function roundTo2(value: number): number {
  if (isNaN(value) || !isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Formats a number with 2 decimal places and thousands separators.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.00';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a percentage with 1 or 2 decimals.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.0%';
  }
  return `${value.toFixed(1)}%`;
}

/**
 * Detects whether an ingredient or recipe cost is missing.
 * Consistent across the entire application: undefined, null, NaN or <= 0 is considered missing.
 */
export function isMissingCost(cost: number | null | undefined): boolean {
  return cost === undefined || cost === null || isNaN(cost) || cost <= 0;
}

/**
 * Rounds UP a value to the nearest step (1, 5, or 10 THB).
 */
export function roundUpToStep(value: number, step: 1 | 5 | 10 = 5): number {
  if (value <= 0) return 0;
  if (step <= 1) return Math.ceil(value);
  return Math.ceil(value / step) * step;
}

/**
 * Normalizes purchase units to base units:
 * kg -> g (1000)
 * g -> g (1)
 * l -> ml (1000)
 * ml -> ml (1)
 * piece/pack -> piece (1)
 */
export function getBaseUnitInfo(purchaseUnit: string): { baseUnit: 'g' | 'ml' | 'piece'; multiplier: number } {
  const normalized = (purchaseUnit || '').toLowerCase().trim();
  if (normalized === 'kg' || normalized === 'กิโลกรัม' || normalized === 'กก.') {
    return { baseUnit: 'g', multiplier: 1000 };
  }
  if (normalized === 'g' || normalized === 'กรัม') {
    return { baseUnit: 'g', multiplier: 1 };
  }
  if (normalized === 'l' || normalized === 'liter' || normalized === 'ลิตร') {
    return { baseUnit: 'ml', multiplier: 1000 };
  }
  if (normalized === 'ml' || normalized === 'มล.' || normalized === 'มิลลิลิตร') {
    return { baseUnit: 'ml', multiplier: 1 };
  }
  return { baseUnit: 'piece', multiplier: 1 };
}

/**
 * Calculates the Edible Portion (EP) cost per base unit for an ingredient given its purchase parameters and yield %.
 * Formula: EP cost = purchase price / (purchase quantity x unit multiplier x yield%)
 */
export function calculateIngredientCostPerBaseUnit(
  purchasePrice: number,
  purchaseQuantity: number,
  yieldPercent: number,
  purchaseUnit: string
): { costPerBaseUnit: number; baseUnit: 'g' | 'ml' | 'piece'; usableBaseUnits: number } {
  const { baseUnit, multiplier } = getBaseUnitInfo(purchaseUnit);

  if (purchaseQuantity <= 0 || purchasePrice <= 0) {
    return { costPerBaseUnit: 0, baseUnit, usableBaseUnits: 0 };
  }

  const effectiveYield = yieldPercent > 0 ? yieldPercent / 100 : 1;
  const rawBaseUnits = purchaseQuantity * multiplier;
  const usableBaseUnits = rawBaseUnits * effectiveYield;

  if (usableBaseUnits <= 0) {
    return { costPerBaseUnit: 0, baseUnit, usableBaseUnits: 0 };
  }

  const costPerBaseUnit = purchasePrice / usableBaseUnits;
  return { costPerBaseUnit, baseUnit, usableBaseUnits };
}

/**
 * Calculates effective cost per base unit taking ingredient's costMethod into account:
 * - 'latest' (default): uses latest costPerBaseUnit.
 * - 'average': average of the last 3 priceHistory entries (or latest if insufficient history).
 */
export function calculateIngredientEffectiveCost(ingredient: IngredientDoc): number {
  if (!ingredient) return 0;
  if (ingredient.costMethod === 'average' && Array.isArray(ingredient.priceHistory) && ingredient.priceHistory.length > 0) {
    const { multiplier } = getBaseUnitInfo(ingredient.purchaseUnit);
    const purchaseQty = ingredient.purchaseQuantity > 0 ? ingredient.purchaseQuantity : 1;
    const historySlice = ingredient.priceHistory.slice(-3); // Last 3 entries

    let sumCosts = 0;
    let count = 0;

    for (const entry of historySlice) {
      const entryPrice = entry.price || 0;
      const entryYield = (entry.yieldPercent > 0 ? entry.yieldPercent : 100) / 100;
      const usableUnits = purchaseQty * multiplier * entryYield;
      if (usableUnits > 0 && entryPrice > 0) {
        sumCosts += entryPrice / usableUnits;
        count += 1;
      }
    }

    if (count > 0) {
      return sumCosts / count;
    }
  }

  return ingredient.costPerBaseUnit || 0;
}

/**
 * Calculates the batch cost and per-output-unit cost of a sub-recipe.
 * Circular-reference protected.
 */
export function calculateSubRecipeCost(
  subRecipe: SubRecipeDoc,
  ingredientsMap: Map<string, IngredientDoc>,
  subRecipesMap: Map<string, SubRecipeDoc>,
  visited: Set<string> = new Set()
): { totalBatchCost: number; costPerOutputUnit: number; hasMissing: boolean } {
  if (visited.has(subRecipe.id)) {
    return { totalBatchCost: 0, costPerOutputUnit: 0, hasMissing: true };
  }
  visited.add(subRecipe.id);

  let totalBatchCost = 0;
  let hasMissing = false;

  // Ingredient costs
  if (Array.isArray(subRecipe.ingredients)) {
    for (const item of subRecipe.ingredients) {
      const ing = ingredientsMap.get(item.ingredientId);
      const effectiveCost = ing ? calculateIngredientEffectiveCost(ing) : 0;
      if (!ing || isMissingCost(effectiveCost)) {
        hasMissing = true;
      } else {
        totalBatchCost += item.quantity * effectiveCost;
      }
    }
  }

  // Nested sub-recipes
  if (Array.isArray(subRecipe.subRecipes)) {
    for (const subItem of subRecipe.subRecipes) {
      const nested = subRecipesMap.get(subItem.subRecipeId);
      if (!nested) {
        hasMissing = true;
      } else {
        const nestedCalc = calculateSubRecipeCost(nested, ingredientsMap, subRecipesMap, new Set(visited));
        totalBatchCost += subItem.quantity * nestedCalc.costPerOutputUnit;
        if (nestedCalc.hasMissing) hasMissing = true;
      }
    }
  }

  const outputQty = subRecipe.outputQuantity > 0 ? subRecipe.outputQuantity : 1;
  const costPerOutputUnit = totalBatchCost / outputQty;

  return { totalBatchCost, costPerOutputUnit, hasMissing };
}

/**
 * Calculates dynamic food and packaging cost for a dish variant.
 * Food COGS (ingredients + sub-recipes) is kept STRICTLY separate from Packaging cost.
 */
export function calculateDishVariantCost(
  variant: DishVariant,
  ingredientsMap: Map<string, IngredientDoc>,
  subRecipesMap: Map<string, SubRecipeDoc>,
  packagingMap: Map<string, PackagingDoc>
): {
  totalCost: number;
  foodCost: number;
  ingredientsCost: number;
  subRecipesCost: number;
  packagingCost: number;
  hasMissing: boolean;
  hasRecipe: boolean;
} {
  let ingredientsCost = 0;
  let subRecipesCost = 0;
  let packagingCost = 0;
  let hasMissing = false;

  const totalLines =
    (variant.ingredients?.length || 0) +
    (variant.subRecipes?.length || 0) +
    (variant.packaging?.length || 0);

  const hasRecipe = totalLines > 0;

  if (Array.isArray(variant.ingredients)) {
    for (const line of variant.ingredients) {
      const ing = ingredientsMap.get(line.ingredientId);
      const effectiveCost = ing ? calculateIngredientEffectiveCost(ing) : 0;
      if (!ing || isMissingCost(effectiveCost)) {
        hasMissing = true;
      } else {
        ingredientsCost += line.quantity * effectiveCost;
      }
    }
  }

  if (Array.isArray(variant.subRecipes)) {
    for (const line of variant.subRecipes) {
      const sub = subRecipesMap.get(line.subRecipeId);
      if (!sub) {
        hasMissing = true;
      } else {
        const subCalc = calculateSubRecipeCost(sub, ingredientsMap, subRecipesMap);
        subRecipesCost += line.quantity * subCalc.costPerOutputUnit;
        if (subCalc.hasMissing) hasMissing = true;
      }
    }
  }

  if (Array.isArray(variant.packaging)) {
    for (const line of variant.packaging) {
      const pkg = packagingMap.get(line.packagingId);
      if (!pkg || isMissingCost(pkg.cost)) {
        hasMissing = true;
      } else {
        packagingCost += line.quantity * pkg.cost;
      }
    }
  }

  const foodCost = ingredientsCost + subRecipesCost;
  const totalCost = foodCost + packagingCost;

  return {
    totalCost,
    foodCost,
    ingredientsCost,
    subRecipesCost,
    packagingCost,
    hasMissing,
    hasRecipe,
  };
}

/**
 * Calculates additional cost of an option choice from its ingredient lines.
 */
export function calculateOptionChoiceCost(
  choice: OptionChoice,
  ingredientsMap: Map<string, IngredientDoc>
): { cost: number; hasMissing: boolean } {
  let cost = 0;
  let hasMissing = false;
  const choiceQty = Math.max(1, Number(choice.quantity) || 1);

  if (Array.isArray(choice.ingredients)) {
    for (const line of choice.ingredients) {
      const ing = ingredientsMap.get(line.ingredientId);
      const effectiveCost = ing ? calculateIngredientEffectiveCost(ing) : 0;
      if (!ing || isMissingCost(effectiveCost)) {
        hasMissing = true;
      } else {
        cost += line.quantity * effectiveCost * choiceQty;
      }
    }
  }

  return { cost, hasMissing };
}

/**
 * Calculates suggested net and menu selling prices:
 * - Suggested NET price = cost / (target food cost % / 100)
 * - Suggested MENU price = net price x (1 + vat%) if pricesIncludeVat, rounded UP to nearest step (1, 5, or 10 THB).
 */
export function calculateSuggestedPricing(
  cost: number,
  targetFoodCostPercent: number,
  pricesIncludeVat: boolean = false,
  vatPercent: number = 7,
  serviceChargeIncludedInPrice: boolean = false,
  serviceChargePercent: number = 10,
  roundingStep: 1 | 5 | 10 = 5
): {
  suggestedNetPrice: number;
  suggestedMenuPrice: number;
} {
  if (cost <= 0 || targetFoodCostPercent <= 0) {
    return { suggestedNetPrice: 0, suggestedMenuPrice: 0 };
  }

  const suggestedNetPrice = roundTo2(cost / (targetFoodCostPercent / 100));

  let rawMenuPrice = suggestedNetPrice;
  if (pricesIncludeVat) {
    if (serviceChargeIncludedInPrice) {
      rawMenuPrice = suggestedNetPrice * (1 + (serviceChargePercent || 0) / 100) * (1 + (vatPercent || 0) / 100);
    } else {
      rawMenuPrice = suggestedNetPrice * (1 + (vatPercent || 0) / 100);
    }
  }

  const suggestedMenuPrice = roundUpToStep(rawMenuPrice, roundingStep);

  return {
    suggestedNetPrice,
    suggestedMenuPrice,
  };
}

/**
 * Calculates **ex-VAT** suggested net selling price: `cost / (targetFoodCostPercent / 100)`.
 * Returns net price before VAT and service charge.
 */
export function calculateExVatSuggestedNetPrice(cost: number, targetFoodCostPercent: number): number {
  return calculateSuggestedPricing(cost, targetFoodCostPercent).suggestedNetPrice;
}

/**
 * Calculates effective price on a specific channel with markup:
 * effective price = base variant price x (1 + markup%)
 */
export function calculateEffectiveChannelPrice(basePrice: number, channel?: ChannelDoc): number {
  const markup = channel?.priceMarkupPercent || 0;
  if (markup <= 0) return basePrice;
  return roundTo2(basePrice * (1 + markup / 100));
}

/**
 * Extracts Net Selling Price from a menu price when pricesIncludeVat (and optionally serviceChargeIncludedInPrice) is true.
 */
export function extractNetPriceFromMenuPrice(
  menuPrice: number,
  pricesIncludeVat: boolean = false,
  vatPercent: number = 7,
  serviceChargeIncludedInPrice: boolean = false,
  serviceChargePercent: number = 10
): number {
  if (menuPrice <= 0) return 0;
  if (!pricesIncludeVat) return roundTo2(menuPrice);
  const vatRate = Math.max(0, vatPercent || 0) / 100;
  const scRate = serviceChargeIncludedInPrice ? Math.max(0, serviceChargePercent || 0) / 100 : 0;
  const factor = (1 + scRate) * (1 + vatRate);
  return factor > 0 ? roundTo2(menuPrice / factor) : roundTo2(menuPrice);
}

/**
 * Calculates Theoretical Food Cost % on an **ex-VAT** net sales basis:
 * Food Cost % = Food COGS / Net Sales (ex-VAT, net of discounts, excluding customer-paid Service Charge).
 */
export function calculateExVatFoodCostPercent(foodCost: number, netSales: number): number {
  if (netSales <= 0 || foodCost <= 0) return 0;
  return roundTo2((foodCost / netSales) * 100);
}

export interface DishSalesStat {
  quantity?: number;
  revenue?: number;
  cost?: number;
}

export interface WeightedFoodCostResult {
  foodCostPercent: number | null;
  totalFoodCost: number;
  totalNetRevenue: number;
  hasSalesData: boolean;
}

/**
 * Computes sales-weighted Food Cost % across actual POS period summaries or orders:
 *   Weighted Food Cost % = (Σ foodCost / Σ netRevenueExVat) × 100
 * Strips VAT & included Service Charge from dishStats[].revenue when pricesIncludeVat is true.
 * Returns foodCostPercent: null when no sales exist (never uses unweighted mean or 31.5/32 fallback).
 */
export function calculateWeightedFoodCostPercent(
  summaries: Array<{
    dishStats?: Record<string, DishSalesStat>;
    netSales?: number;
    totalFoodCost?: number;
  }>,
  vatOptions?: {
    pricesIncludeVat?: boolean;
    vatPercent?: number;
    serviceChargeIncludedInPrice?: boolean;
    serviceChargePercent?: number;
  }
): WeightedFoodCostResult {
  const pricesIncludeVat = Boolean(vatOptions?.pricesIncludeVat);
  const vatRate = Math.max(0, vatOptions?.vatPercent ?? 7) / 100;
  const scRate = vatOptions?.serviceChargeIncludedInPrice
    ? Math.max(0, vatOptions?.serviceChargePercent ?? 0) / 100
    : 0;
  const taxDivisor = pricesIncludeVat ? (1 + scRate) * (1 + vatRate) : 1;

  let totalDishCost = 0;
  let totalDishGrossRev = 0;
  let totalSummaryCost = 0;
  let totalSummaryNetSales = 0;

  for (const s of summaries) {
    if (s.dishStats) {
      for (const dst of Object.values(s.dishStats)) {
        if (!dst) continue;
        totalDishCost += Math.max(0, Number(dst.cost) || 0);
        totalDishGrossRev += Math.max(0, Number(dst.revenue) || 0);
      }
    }
    totalSummaryCost += Math.max(0, Number(s.totalFoodCost) || 0);
    totalSummaryNetSales += Math.max(0, Number(s.netSales) || 0);
  }

  if (totalDishGrossRev > 0) {
    const netRevenue = taxDivisor > 0 ? totalDishGrossRev / taxDivisor : totalDishGrossRev;
    return {
      foodCostPercent: netRevenue > 0 ? (totalDishCost / netRevenue) * 100 : null,
      totalFoodCost: totalDishCost,
      totalNetRevenue: netRevenue,
      hasSalesData: netRevenue > 0,
    };
  }

  if (totalSummaryNetSales > 0) {
    return {
      foodCostPercent: (totalSummaryCost / totalSummaryNetSales) * 100,
      totalFoodCost: totalSummaryCost,
      totalNetRevenue: totalSummaryNetSales,
      hasSalesData: true,
    };
  }

  return {
    foodCostPercent: null,
    totalFoodCost: 0,
    totalNetRevenue: 0,
    hasSalesData: false,
  };
}

/**
 * Calculates Contribution Margin (CM) per item:
 * CM = net price - food cost - packaging - platform commission
 * CM % = (CM / net price) * 100
 */
export function calculateItemContributionMargin(
  netPrice: number,
  foodCost: number,
  packagingCost: number = 0,
  platformCommission: number = 0
): {
  contributionMargin: number;
  contributionMarginPercent: number;
} {
  const cm = roundTo2(netPrice - foodCost - packagingCost - platformCommission);
  const cmPercent = netPrice > 0 ? roundTo2((cm / netPrice) * 100) : 0;
  return {
    contributionMargin: cm,
    contributionMarginPercent: cmPercent,
  };
}

/**
 * USALI Bill Financials Calculation:
 * - Handles both pricesIncludeVat (VAT extraction) and exclusive VAT.
 * - Separates Food COGS from packaging.
 * - Packaging from variant recipe applies only to takeaway/delivery, never dine-in.
 * - Channel.packagingCost is added ONLY if order recipes contain no packaging lines.
 * - Platform commission computed on net food sales (+ VAT on commission if commissionVatAsCost is true).
 */
export function calculateBillFinancials(
  items: OrderItem[],
  discountAmountInput: number,
  serviceChargePercent: number,
  vatPercent: number,
  channel?: ChannelDoc,
  settingsOptions?: {
    pricesIncludeVat?: boolean;
    serviceChargeIncludedInPrice?: boolean;
    serviceChargeTreatment?: 'staff_pool' | 'retained';
    commissionBase?: 'net_food_sales';
    commissionVatAsCost?: boolean;
  }
): {
  subtotal: number;
  discountAmount: number;
  taxableSubtotal: number;
  serviceChargeAmount: number;
  vatAmount: number;
  grandTotal: number;
  netSales: number; // Net food sales (revenue basis)
  totalFoodCost: number; // Food COGS only
  packagingCost: number; // Packaging only
  platformFee: number;
  grossProfit: number;
  foodCostPercent: number;
  contributionMargin: number;
  contributionMarginPercent: number;
} {
  let subtotal = 0;
  let totalFoodCost = 0;
  let orderPackagingFromItems = 0;

  const isDineIn = channel?.type === 'dine_in';

  for (const item of items) {
    const qty = item.quantity || 1;
    subtotal += item.unitPrice * qty;

    // Food COGS snapshot: fallback to totalUnitCostSnapshot for legacy items
    const foodCostUnit = item.foodCostSnapshot !== undefined ? item.foodCostSnapshot : item.totalUnitCostSnapshot;
    totalFoodCost += foodCostUnit * qty;

    // Packaging: applies only for takeaway/delivery channels, never dine-in
    if (!isDineIn) {
      const packagingCostUnit = item.packagingCostSnapshot !== undefined ? item.packagingCostSnapshot : 0;
      orderPackagingFromItems += packagingCostUnit * qty;
    }
  }

  // Packaging rule: Channel.packagingCost (per order) is used ONLY if recipes contain no packaging lines
  let packagingCost = 0;
  if (!isDineIn) {
    if (orderPackagingFromItems > 0) {
      packagingCost = orderPackagingFromItems;
    } else {
      packagingCost = channel?.packagingCost || 0;
    }
  }

  const discountAmount = Math.max(0, Math.min(discountAmountInput, subtotal));
  const payableBeforeTax = Math.max(0, subtotal - discountAmount);

  const pricesIncludeVat = Boolean(settingsOptions?.pricesIncludeVat);
  const serviceChargeIncludedInPrice = Boolean(settingsOptions?.serviceChargeIncludedInPrice);
  const scRate = Math.max(0, serviceChargePercent || 0) / 100;
  const vatRate = Math.max(0, vatPercent || 0) / 100;

  let netSales = 0;
  let taxableSubtotal = 0;
  let serviceChargeAmount = 0;
  let vatAmount = 0;
  let grandTotal = 0;

  if (pricesIncludeVat) {
    if (serviceChargeIncludedInPrice) {
      // Both VAT and Service Charge are already built into the menu prices
      const factor = (1 + scRate) * (1 + vatRate);
      netSales = factor > 0 ? roundTo2(payableBeforeTax / factor) : payableBeforeTax;
      taxableSubtotal = netSales;
      serviceChargeAmount = roundTo2(netSales * scRate);
      vatAmount = roundTo2((netSales + serviceChargeAmount) * vatRate);
      grandTotal = payableBeforeTax;
    } else {
      // Menu price includes VAT, service charge is added on top
      netSales = vatRate > -1 ? roundTo2(payableBeforeTax / (1 + vatRate)) : payableBeforeTax;
      taxableSubtotal = netSales;
      const vatFood = roundTo2(payableBeforeTax - netSales);
      serviceChargeAmount = roundTo2(netSales * scRate);
      const vatSc = roundTo2(serviceChargeAmount * vatRate);
      vatAmount = roundTo2(vatFood + vatSc);
      grandTotal = roundTo2(payableBeforeTax + serviceChargeAmount + vatSc);
    }
  } else {
    // Menu prices are net (exclusive of VAT and Service Charge)
    netSales = payableBeforeTax;
    taxableSubtotal = payableBeforeTax;
    serviceChargeAmount = roundTo2(taxableSubtotal * scRate);
    const vatBase = taxableSubtotal + serviceChargeAmount;
    vatAmount = roundTo2(vatBase * vatRate);
    grandTotal = roundTo2(taxableSubtotal + serviceChargeAmount + vatAmount);
  }

  // Platform commission
  let platformFee = 0;
  if (channel && channel.commissionPercent > 0) {
    const rawCommission = (netSales * channel.commissionPercent) / 100;
    if (settingsOptions?.commissionVatAsCost) {
      platformFee = roundTo2(rawCommission * 1.07); // 7% VAT on platform fee added as cost
    } else {
      platformFee = roundTo2(rawCommission);
    }
  }

  // USALI Gross Profit = Net Sales - Food COGS
  const grossProfit = roundTo2(netSales - totalFoodCost);
  const foodCostPercent = netSales > 0 ? roundTo2((totalFoodCost / netSales) * 100) : 0;

  // Contribution Margin
  const contributionMargin = roundTo2(netSales - totalFoodCost - packagingCost - platformFee);
  const contributionMarginPercent = netSales > 0 ? roundTo2((contributionMargin / netSales) * 100) : 0;

  return {
    subtotal: roundTo2(subtotal),
    discountAmount: roundTo2(discountAmount),
    taxableSubtotal: roundTo2(taxableSubtotal),
    serviceChargeAmount: roundTo2(serviceChargeAmount),
    vatAmount: roundTo2(vatAmount),
    grandTotal: roundTo2(grandTotal),
    netSales: roundTo2(netSales),
    totalFoodCost: roundTo2(totalFoodCost),
    packagingCost: roundTo2(packagingCost),
    platformFee: roundTo2(platformFee),
    grossProfit: roundTo2(grossProfit),
    foodCostPercent,
    contributionMargin,
    contributionMarginPercent,
  };
}

/**
 * Calculates the business work date (YYYY-MM-DD) taking dailyClosingTime into account.
 */
export function getBusinessWorkDate(dateObj: Date = new Date(), dailyClosingTime: string = '04:00'): string {
  const [closingHoursStr, closingMinutesStr] = (dailyClosingTime || '04:00').split(':');
  const closingHour = parseInt(closingHoursStr, 10) || 0;
  const closingMinute = parseInt(closingMinutesStr, 10) || 0;

  const currentHour = dateObj.getHours();
  const currentMinute = dateObj.getMinutes();

  const adjustedDate = new Date(dateObj.getTime());

  if (currentHour < closingHour || (currentHour === closingHour && currentMinute < closingMinute)) {
    adjustedDate.setDate(adjustedDate.getDate() - 1);
  }

  const year = adjustedDate.getFullYear();
  const month = String(adjustedDate.getMonth() + 1).padStart(2, '0');
  const day = String(adjustedDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Returns exact number of days in a given calendar month (1-indexed month, e.g. 2 for Feb).
 * Accounts for leap years automatically.
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Returns exact YYYY-MM-DD start and end dates for a YYYY-MM string, fixing any 31-day bugs.
 */
export function getMonthDateRange(yearMonth: string): { startDate: string; endDate: string; daysInMonth: number } {
  const [yStr, mStr] = yearMonth.split('-');
  const year = parseInt(yStr, 10) || new Date().getFullYear();
  const month = parseInt(mStr, 10) || 1;
  const daysInMonth = getDaysInMonth(year, month);
  const startDate = `${yearMonth}-01`;
  const endDate = `${yearMonth}-${String(daysInMonth).padStart(2, '0')}`;
  return { startDate, endDate, daysInMonth };
}

/**
 * Normalizes channel identifiers across POS ('dine_in') and Costing ('dine-in').
 */
export function normalizeChannelId(channelId: string | null | undefined): string {
  const raw = (channelId || '').trim().toLowerCase().replace(/-/g, '_');
  if (raw === 'dinein') return 'dine_in';
  if (raw === 'take_away') return 'takeaway';
  if (raw === 'grabfood') return 'grab';
  if (raw === 'line_man') return 'lineman';
  return raw || 'other';
}

/**
 * Determines whether an employee belongs to direct kitchen staff.
 */
export function isKitchenEmployee(employee: EmployeeDoc): boolean {
  if (employee.roleCategory === 'direct_kitchen' || employee.department === 'kitchen') return true;
  if (employee.roleCategory === 'direct_service' || employee.roleCategory === 'indirect_management') return false;
  if (employee.department === 'front_of_house' || employee.department === 'management') return false;
  const roleLower = (employee.role || '').toLowerCase();
  return (
    roleLower.includes('chef') ||
    roleLower.includes('cook') ||
    roleLower.includes('kitchen') ||
    roleLower.includes('ครัว') ||
    roleLower.includes('เชฟ') ||
    roleLower.includes('กุ๊ก')
  );
}

export interface LaborCostOptions {
  socialSecurityEnabled?: boolean;
  socialSecurityRatePercent?: number; // Default 5%
  socialSecurityCapWage?: number; // Default 15,000 THB/month wage ceiling (max 750 THB/mo)
  defaultOperatingDays?: number; // Default 26
}

export interface UnifiedEmployeeInput {
  isActive?: boolean;
  active?: boolean;
  wageType?: 'monthly' | 'daily' | 'hourly';
  type?: 'monthly' | 'daily' | 'hourly';
  employmentType?: 'full_time' | 'part_time' | 'hourly';
  wageAmount?: number;
  wageRate?: number;
  baseSalary?: number;
  hourlyRate?: number;
  workDaysOrHoursPerMonth?: number;
  standardHoursPerMonth?: number;
  hoursPerMonth?: number;
  monthlyCost?: number;
  overtimeHoursMonthly?: number;
  overtimeRateMultiplier?: number;
  benefitsMonthly?: number;
}

/**
 * Single Source of Truth for an employee's monthly cost across POS & Costing modules:
 * (base monthly wage + overtime + benefitsMonthly) + employer Social Security (if enabled).
 * Explicitly parenthesizes expressions so benefits/OT/SSO are never dropped when monthlyCost is set.
 * Correctly handles hourly workers (hourlyRate × hours) without ever returning just ฿65.
 */
export function getEmployeeMonthlyCost(
  employee: UnifiedEmployeeInput,
  options?: LaborCostOptions
): number {
  if (employee.isActive === false || employee.active === false) return 0;

  const isHourly =
    employee.wageType === 'hourly' ||
    employee.type === 'hourly' ||
    employee.employmentType === 'hourly';
  const isDaily = employee.wageType === 'daily' || employee.type === 'daily';

  const defaultDays = options?.defaultOperatingDays && options.defaultOperatingDays > 0
    ? options.defaultOperatingDays
    : 26;

  let baseMonthly = 0;
  let hourlyEquivRate = 0;

  if (isHourly) {
    const hours =
      Number(
        employee.standardHoursPerMonth ??
          employee.hoursPerMonth ??
          employee.workDaysOrHoursPerMonth
      ) || 208;
    const rate =
      Number(employee.wageAmount ?? employee.wageRate ?? employee.hourlyRate) || 0;
    baseMonthly = rate > 0 ? rate * hours : Number(employee.monthlyCost) || 0;
    hourlyEquivRate = rate > 0 ? rate : hours > 0 ? baseMonthly / hours : 0;
  } else if (isDaily) {
    const days =
      Number(
        employee.workDaysOrHoursPerMonth ??
          employee.standardHoursPerMonth ??
          employee.hoursPerMonth
      ) || defaultDays;
    const rate =
      Number(employee.wageAmount ?? employee.wageRate ?? employee.baseSalary) || 0;
    baseMonthly = rate > 0 ? rate * days : Number(employee.monthlyCost) || 0;
    hourlyEquivRate = rate > 0 ? rate / 8 : days > 0 ? baseMonthly / (days * 8) : 0;
  } else {
    baseMonthly =
      Number(
        employee.monthlyCost ??
          employee.wageAmount ??
          employee.wageRate ??
          employee.baseSalary
      ) || 0;
    hourlyEquivRate = baseMonthly / 208;
  }

  let overtimeMonthly = 0;
  const otHours = Number(employee.overtimeHoursMonthly) || 0;
  if (otHours > 0) {
    const multiplier = Number(employee.overtimeRateMultiplier) || 1.5;
    overtimeMonthly = hourlyEquivRate * otHours * multiplier;
  }

  const benefits = Number(employee.benefitsMonthly) || 0;

  let employerSso = 0;
  if (options?.socialSecurityEnabled) {
    const ratePct =
      typeof options.socialSecurityRatePercent === 'number' &&
      Number.isFinite(options.socialSecurityRatePercent)
        ? Math.max(0, options.socialSecurityRatePercent)
        : 5;
    const capWage =
      typeof options.socialSecurityCapWage === 'number' &&
      Number.isFinite(options.socialSecurityCapWage)
        ? Math.max(0, options.socialSecurityCapWage)
        : 15000;
    const ssoWageBase = Math.min(Math.max(0, baseMonthly), capWage);
    employerSso = ssoWageBase * (ratePct / 100);
  }

  return (baseMonthly + overtimeMonthly) + benefits + employerSso;
}

/**
 * Calculates monthly equivalent cost of an employee (base wage + overtime + benefits + optional SSO).
 */
export function calculateEmployeeMonthlyCost(
  employee: UnifiedEmployeeInput,
  options?: LaborCostOptions
): number {
  return getEmployeeMonthlyCost(employee, options);
}

/**
 * Normalizes a period monetary value (day, month, or year) to a monthly equivalent
 * using real calendar days in that month or actual coveredMonths (never hardcoded 30 or x12).
 */
export function normalizeToMonthly(
  periodValue: number,
  period: 'day' | 'month' | 'year',
  coveredMonths?: number,
  dateParam?: string
): number {
  if (!Number.isFinite(periodValue)) return 0;

  if (period === 'day') {
    if (typeof coveredMonths === 'number' && Number.isFinite(coveredMonths) && coveredMonths > 0) {
      return coveredMonths < 1 ? periodValue / coveredMonths : periodValue * coveredMonths;
    }
    const ym =
      dateParam && dateParam.length >= 7
        ? dateParam.substring(0, 7)
        : new Date().toISOString().substring(0, 7);
    const { daysInMonth } = getMonthDateRange(ym);
    return periodValue * daysInMonth;
  }

  if (period === 'month') {
    const months =
      typeof coveredMonths === 'number' && Number.isFinite(coveredMonths) && coveredMonths > 0
        ? coveredMonths
        : 1;
    return periodValue / months;
  }

  // period === 'year'
  if (typeof coveredMonths === 'number' && Number.isFinite(coveredMonths) && coveredMonths > 0) {
    return periodValue / coveredMonths;
  }
  const targetYearNum = dateParam ? parseInt(dateParam.substring(0, 4), 10) : NaN;
  const now = new Date();
  const fallbackMonths =
    Number.isFinite(targetYearNum) && targetYearNum === now.getFullYear()
      ? Math.max(1, now.getMonth() + 1)
      : 12;
  return periodValue / fallbackMonths;
}

/**
 * Produces a clear UI subtitle showing which period's sales were used for calculation.
 */
export function formatPeriodCalculationLabel(
  period: 'day' | 'month' | 'year',
  dateParam: string,
  lang: 'th' | 'en' = 'th'
): string {
  if (lang === 'th') {
    if (period === 'day') return `คำนวณจากยอดขายวันที่ ${dateParam}`;
    if (period === 'month') return `คำนวณจากยอดขายเดือน ${dateParam}`;
    return `คำนวณจากยอดขายปี ${dateParam}`;
  }
  if (period === 'day') return `Calculated from sales on ${dateParam}`;
  if (period === 'month') return `Calculated from sales in ${dateParam}`;
  return `Calculated from sales in ${dateParam}`;
}

/**
 * Identifies payroll expenses via explicit `isPayroll` boolean flag (or legacy Labor category),
 * never via brittle keyword matching that false-positives on e.g. "ค่าแรงช่างซ่อมแอร์".
 */
export function isExplicitPayrollExpense(expense: {
  isPayroll?: boolean;
  category?: string;
}): boolean {
  if (typeof expense.isPayroll === 'boolean') {
    return expense.isPayroll;
  }
  return expense.category === 'Labor (Salary & Wages)';
}

function isRecurringExpenseActiveInMonth(exp: ExpenseDoc, targetMonth: string): boolean {
  const startMonth = (exp.date || '').substring(0, 7);
  if (!startMonth || startMonth > targetMonth) return false;
  const endMonth =
    exp.endDate && exp.endDate.trim().length >= 7 ? exp.endDate.trim().substring(0, 7) : '';
  if (endMonth && targetMonth > endMonth) return false;
  return true;
}

export function isDateInPeriod(dateStr: string, period: 'day' | 'month' | 'year', dateParam: string): boolean {
  if (!dateStr) return false;
  if (period === 'day') return dateStr === dateParam;
  if (period === 'month') return dateStr.startsWith(dateParam);
  return dateStr.startsWith(dateParam);
}

/**
 * Unrounded internal allocator so buildPeriodPnl avoids intermediate rounding drift (Rule 3).
 */
export function allocatePeriodExpensesAndLaborRaw(
  period: 'day' | 'month' | 'year',
  dateParam: string, // YYYY-MM-DD for day, YYYY-MM for month, YYYY for year
  expenses: ExpenseDoc[],
  employees: EmployeeDoc[],
  summariesInPeriod?: DailySummaryDoc[],
  laborOptions?: LaborCostOptions
): {
  fixedExpenses: number;
  variableExpenses: number;
  operatingExpenses: number;
  laborCost: number;
  kitchenLaborCost: number;
  fohLaborCost: number;
  daysInPeriod: number;
  coveredMonths: number;
} {
  let monthlyKitchenLabor = 0;
  let monthlyFohLabor = 0;
  for (const emp of employees) {
    const cost = getEmployeeMonthlyCost(emp, laborOptions);
    if (cost <= 0) continue;
    if (isKitchenEmployee(emp)) {
      monthlyKitchenLabor += cost;
    } else {
      monthlyFohLabor += cost;
    }
  }
  const monthlyLabor = monthlyKitchenLabor + monthlyFohLabor;

  if (period === 'day') {
    const [yStr, mStr] = dateParam.split('-');
    const year = parseInt(yStr, 10) || new Date().getFullYear();
    const month = parseInt(mStr, 10) || 1;
    const daysInMonth = getDaysInMonth(year, month);
    const targetMonth = dateParam.substring(0, 7);

    let fixedExpenses = 0;
    let variableExpenses = 0;

    for (const exp of expenses) {
      if (exp.isRecurring) {
        if (isRecurringExpenseActiveInMonth(exp, targetMonth)) {
          if (exp.isFixed === false) {
            variableExpenses += exp.amount / daysInMonth;
          } else {
            fixedExpenses += exp.amount / daysInMonth;
          }
        }
      } else {
        if (exp.date === dateParam) {
          if (exp.isFixed) {
            fixedExpenses += exp.amount;
          } else {
            variableExpenses += exp.amount;
          }
        }
      }
    }

    const kitchenLaborCost = monthlyKitchenLabor / daysInMonth;
    const fohLaborCost = monthlyFohLabor / daysInMonth;
    const laborCost = monthlyLabor / daysInMonth;
    const operatingExpenses = fixedExpenses + variableExpenses;

    return {
      fixedExpenses,
      variableExpenses,
      operatingExpenses,
      laborCost,
      kitchenLaborCost,
      fohLaborCost,
      daysInPeriod: 1,
      coveredMonths: 1 / daysInMonth,
    };
  }

  if (period === 'month') {
    const [yStr, mStr] = dateParam.split('-');
    const year = parseInt(yStr, 10) || new Date().getFullYear();
    const month = parseInt(mStr, 10) || 1;
    const daysInMonth = getDaysInMonth(year, month);
    const targetMonth = dateParam;

    let fixedExpenses = 0;
    let variableExpenses = 0;

    for (const exp of expenses) {
      if (exp.isRecurring) {
        if (isRecurringExpenseActiveInMonth(exp, targetMonth)) {
          if (exp.isFixed === false) {
            variableExpenses += exp.amount;
          } else {
            fixedExpenses += exp.amount;
          }
        }
      } else {
        if (exp.date.startsWith(targetMonth)) {
          if (exp.isFixed) {
            fixedExpenses += exp.amount;
          } else {
            variableExpenses += exp.amount;
          }
        }
      }
    }

    const kitchenLaborCost = monthlyKitchenLabor;
    const fohLaborCost = monthlyFohLabor;
    const laborCost = monthlyLabor;
    const operatingExpenses = fixedExpenses + variableExpenses;

    return {
      fixedExpenses,
      variableExpenses,
      operatingExpenses,
      laborCost,
      kitchenLaborCost,
      fohLaborCost,
      daysInPeriod: daysInMonth,
      coveredMonths: 1,
    };
  }

  // period === 'year': Determine actually covered months in targetYear
  const targetYear = dateParam;
  const targetYearNum = parseInt(targetYear, 10) || new Date().getFullYear();
  const now = new Date();
  const currentYearNum = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;

  const summaryMonths = (summariesInPeriod || [])
    .filter((s) => s.date.startsWith(targetYear))
    .map((s) => parseInt(s.date.substring(5, 7), 10))
    .filter((m) => m >= 1 && m <= 12);

  const expenseMonthsInYear = expenses
    .filter((e) => e.date.startsWith(targetYear))
    .map((e) => parseInt(e.date.substring(5, 7), 10))
    .filter((m) => m >= 1 && m <= 12);

  let endMonth = 12;
  if (targetYearNum > currentYearNum) {
    endMonth = summaryMonths.length > 0 ? Math.max(...summaryMonths) : 0;
  } else if (targetYearNum === currentYearNum) {
    endMonth = Math.max(currentMonthNum, summaryMonths.length > 0 ? Math.max(...summaryMonths) : 0);
  } else if (summaryMonths.length > 0) {
    endMonth = 12;
  }

  let startMonth = 1;
  const observedMonths = [...summaryMonths, ...expenseMonthsInYear];
  if (observedMonths.length > 0) {
    startMonth = Math.min(...observedMonths);
  }

  const activeMonthNumbers: number[] = [];
  if (endMonth >= startMonth && endMonth >= 1) {
    for (let m = startMonth; m <= endMonth; m++) {
      activeMonthNumbers.push(m);
    }
  }

  let totalFixed = 0;
  let totalVariable = 0;
  let totalKitchenLabor = 0;
  let totalFohLabor = 0;
  let totalDays = 0;

  for (const m of activeMonthNumbers) {
    const mStr = `${targetYear}-${String(m).padStart(2, '0')}`;
    totalDays += getDaysInMonth(targetYearNum, m);
    for (const exp of expenses) {
      if (exp.isRecurring && isRecurringExpenseActiveInMonth(exp, mStr)) {
        if (exp.isFixed === false) {
          totalVariable += exp.amount;
        } else {
          totalFixed += exp.amount;
        }
      }
    }
    totalKitchenLabor += monthlyKitchenLabor;
    totalFohLabor += monthlyFohLabor;
  }

  // One-off expenses occurring in targetYear (strictly matching targetYear)
  for (const exp of expenses) {
    if (!exp.isRecurring && exp.date.startsWith(targetYear)) {
      if (exp.isFixed) {
        totalFixed += exp.amount;
      } else {
        totalVariable += exp.amount;
      }
    }
  }

  const totalLabor = totalKitchenLabor + totalFohLabor;
  return {
    fixedExpenses: totalFixed,
    variableExpenses: totalVariable,
    operatingExpenses: totalFixed + totalVariable,
    laborCost: totalLabor,
    kitchenLaborCost: totalKitchenLabor,
    fohLaborCost: totalFohLabor,
    daysInPeriod: totalDays || 365,
    coveredMonths: activeMonthNumbers.length,
  };
}

/**
 * Filters and allocates expenses and labor for a given period (day, month, or year).
 * - Recurring expenses: expanded into active months between start date and optional endDate.
 * - One-off / variable expenses: filtered strictly by their date.
 * - Allocates monthly fixed costs/labor to a day using real days in that month,
 *   and to a year using the months actually covered (never hardcoded 30 or x12).
 */
export function calculatePeriodExpensesAndLabor(
  period: 'day' | 'month' | 'year',
  dateParam: string,
  expenses: ExpenseDoc[],
  employees: EmployeeDoc[],
  summariesInPeriod?: DailySummaryDoc[],
  laborOptions?: LaborCostOptions
): {
  fixedExpenses: number;
  variableExpenses: number;
  operatingExpenses: number;
  laborCost: number;
  kitchenLaborCost: number;
  fohLaborCost: number;
  daysInPeriod: number;
  coveredMonths: number;
} {
  const raw = allocatePeriodExpensesAndLaborRaw(
    period,
    dateParam,
    expenses,
    employees,
    summariesInPeriod,
    laborOptions
  );
  return {
    fixedExpenses: roundTo2(raw.fixedExpenses),
    variableExpenses: roundTo2(raw.variableExpenses),
    operatingExpenses: roundTo2(raw.operatingExpenses),
    laborCost: roundTo2(raw.laborCost),
    kitchenLaborCost: roundTo2(raw.kitchenLaborCost),
    fohLaborCost: roundTo2(raw.fohLaborCost),
    daysInPeriod: raw.daysInPeriod,
    coveredMonths: raw.coveredMonths,
  };
}

export type BenchmarkStatus = 'good' | 'warning' | 'danger';
export type PnlDataStatus = 'complete' | 'estimated' | 'incomplete';

export interface UsaliPnlResult {
  netSales: number;
  retainedServiceCharge: number;
  totalRevenue: number;
  totalFoodCost: number;
  theoreticalFoodCostPercent: number;
  grossProfit: number;
  grossProfitMarginPercent: number;
  packagingCost: number;
  platformFees: number;
  laborCost: number;
  laborPercent: number;
  laborStatus: BenchmarkStatus;
  fixedExpenses: number;
  variableExpenses: number;
  operatingExpenses: number;
  primeCost: number;
  primeCostPercent: number;
  primeCostStatus: BenchmarkStatus;
  netOperatingProfit: number;
  netProfitMarginPercent: number;
  orderCount: number;
  avgOrderValue: number;
  grossSales: number;
  discounts: number;
  vatTotal: number;
  serviceChargeCollected: number;
  coveredMonths: number;
  daysInPeriod: number;
}

export function getPeriodDateBounds(
  period: 'day' | 'month' | 'year',
  dateParam: string
): { periodStart: string; periodEnd: string } {
  if (period === 'day') {
    return { periodStart: dateParam, periodEnd: dateParam };
  }
  if (period === 'month') {
    const [yStr, mStr] = dateParam.split('-');
    const year = parseInt(yStr, 10) || new Date().getFullYear();
    const month = parseInt(mStr, 10) || 1;
    const days = getDaysInMonth(year, month);
    const monthPrefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    return {
      periodStart: `${monthPrefix}-01`,
      periodEnd: `${monthPrefix}-${String(days).padStart(2, '0')}`,
    };
  }
  const yearStr = dateParam.slice(0, 4);
  return {
    periodStart: `${yearStr}-01-01`,
    periodEnd: `${yearStr}-12-31`,
  };
}

export function resolveStockCountSnapshotsForPeriod(
  snapshots: StockCountSnapshot[],
  periodStart: string,
  periodEnd: string,
  todayDate?: string
): {
  beginningSnapshot: StockCountSnapshot | null;
  endingSnapshot: StockCountSnapshot | null;
  hasCompletePair: boolean;
} {
  const todayStr = todayDate || new Date().toISOString().slice(0, 10);
  const valid = (snapshots || [])
    .filter(
      (s) =>
        s &&
        typeof s.date === 'string' &&
        s.date.length >= 10 &&
        typeof s.totalValue === 'number' &&
        Number.isFinite(s.totalValue)
    )
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      const createdCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      if (createdCmp !== 0) return createdCmp;
      return (a.id || '').localeCompare(b.id || '');
    });

  // Beginning stock: latest snapshot strictly BEFORE periodStart
  let beginningSnapshot: StockCountSnapshot | null = null;
  for (const s of valid) {
    if (s.date < periodStart) {
      beginningSnapshot = s;
    }
  }

  // Ending stock: latest snapshot ON OR AFTER periodEnd and NOT AFTER today
  let endingSnapshot: StockCountSnapshot | null = null;
  for (const s of valid) {
    if (s.date >= periodEnd && s.date <= todayStr) {
      endingSnapshot = s;
    }
  }

  return {
    beginningSnapshot,
    endingSnapshot,
    hasCompletePair: Boolean(beginningSnapshot && endingSnapshot),
  };
}

export function isPackagingPurchase(
  purchase: PurchaseRecord,
  ingredients?: Array<{ id: string; category: string }>
): boolean {
  if (!purchase) return false;
  if (purchase.isPackaging === true) return true;

  const isPkgCategory = (cat?: string) => {
    if (!cat) return false;
    const c = cat.toLowerCase();
    return c.includes('packaging') || c.includes('บรรจุภัณฑ์');
  };

  if (isPkgCategory(purchase.category)) return true;

  if (ingredients && purchase.ingredientId) {
    const ing = ingredients.find((i) => i.id === purchase.ingredientId);
    if (ing && isPkgCategory(ing.category)) return true;
  }

  return false;
}

export function filterPeriodPurchases(
  purchases: PurchaseRecord[],
  periodStart: string,
  periodEnd: string,
  ingredients?: Array<{ id: string; category: string }>
): {
  foodPurchases: PurchaseRecord[];
  packagingPurchases: PurchaseRecord[];
  totalFoodPurchases: number;
  totalPackagingPurchases: number;
} {
  const foodPurchases: PurchaseRecord[] = [];
  const packagingPurchases: PurchaseRecord[] = [];
  let totalFoodPurchases = 0;
  let totalPackagingPurchases = 0;

  for (const p of purchases || []) {
    if (!p || !p.date || p.date < periodStart || p.date > periodEnd) continue;
    const amount = Math.max(0, Number(p.totalPrice ?? p.price ?? 0) || 0);
    if (isPackagingPurchase(p, ingredients)) {
      packagingPurchases.push(p);
      totalPackagingPurchases += amount;
    } else {
      foodPurchases.push(p);
      totalFoodPurchases += amount;
    }
  }

  return {
    foodPurchases,
    packagingPurchases,
    totalFoodPurchases,
    totalPackagingPurchases,
  };
}

export function filterPeriodWaste<
  T extends { date?: string; totalCost?: number; cost?: number } = WasteRecord
>(
  wasteLog: T[],
  periodStart: string,
  periodEnd: string
): {
  periodWaste: T[];
  totalWasteCost: number;
} {
  const periodWaste: T[] = [];
  let totalWasteCost = 0;

  for (const w of wasteLog || []) {
    if (!w || !w.date || w.date < periodStart || w.date > periodEnd) continue;
    const cost = Math.max(0, Number(w.totalCost ?? w.cost ?? 0) || 0);
    periodWaste.push(w);
    totalWasteCost += cost;
  }

  return {
    periodWaste,
    totalWasteCost,
  };
}

export interface BuildPeriodPnlInput {
  summaries: DailySummaryDoc[];
  manualSales?: DailySalesRecord[];
  expenses: ExpenseDoc[];
  employees: EmployeeDoc[];
  period: 'day' | 'month' | 'year';
  dateParam: string;
  settings: Partial<
    Pick<
      SettingsDoc,
      | 'serviceChargeTreatment'
      | 'vatPercent'
      | 'incomeTaxRatePercent'
      | 'cogsVarianceThresholdPercent'
      | 'socialSecurityEnabled'
      | 'socialSecurityRatePercent'
      | 'socialSecurityCapWage'
    >
  >;
  cogsMode: 'estimated' | 'actual';
  stockCountSnapshots?: StockCountSnapshot[];
  purchases?: PurchaseRecord[];
  wasteLog?: WasteRecord[];
  ingredients?: Array<Pick<Ingredient, 'id' | 'category'>>;
  salesOrders?: SaleOrder[];
  todayDate?: string;
  actualCogsInput?: {
    beginningInventory?: number | null;
    purchases?: number;
    endingInventory?: number | null;
    waste?: number;
    packagingFromOrders?: number;
    hasActualData?: boolean;
  };
  manualFallbackRates?: {
    foodCostPercent?: number | null;
    packagingPercent?: number | null;
  };
}

export interface PeriodPnlResult {
  period: 'day' | 'month' | 'year';
  dateParam: string;
  daysInPeriod: number;
  coveredMonths: number;

  // Reference metrics (display only, never used to recompute revenue)
  grossSalesRef: number;
  discountsRef: number;
  refundsRef: number;
  serviceChargeCollected: number;
  retainedServiceCharge: number;
  vatTotal: number;
  orderCount: number;
  avgOrderValue: number;

  // Ordered P&L Lines
  netSalesExVat: number;
  totalRevenue: number;
  foodCogs: number;
  packagingCogs: number;
  totalCogs: number;
  grossProfit: number;
  grossMarginPercent: number;

  channelFees: number;

  totalLabor: number;
  kitchenLabor: number;
  fohLabor: number;
  laborPercent: number;
  laborStatus: BenchmarkStatus;

  opex: number;
  fixedExpenses: number;
  variableExpenses: number;

  operatingProfit: number;
  operatingMarginPercent: number;

  taxRatePercent: number;
  estimatedTax: number;
  netProfit: number;
  netMarginPercent: number;

  // Prime Cost = Total COGS (Food + Packaging) + Total Labor (all departments + benefits)
  primeCost: number;
  primeCostPercent: number;
  primeCostStatus: BenchmarkStatus;

  foodCostPercent: number;

  // Inventory / Theoretical / Variance & Advisory fields
  theoreticalFoodCogs: number;
  actualFoodCogs: number | null;
  cogsSource: 'actual' | 'theoretical';
  cogsLabel: string;
  hasCompleteStockSnapshots: boolean;
  beginningStockSnapshot: StockCountSnapshot | null;
  endingStockSnapshot: StockCountSnapshot | null;
  periodFoodPurchases: number;
  periodPackagingPurchasesExcluded: number;
  wasteMemo: number;
  varianceAmount: number;
  variancePercent: number;
  variancePercentOfSales: number;
  varianceStatus: 'OVER_BUDGET' | 'ON_TRACK' | 'SAVINGS';
  uncostedManualSalesAmount: number;
  uncostedManualSalesWarning: string | null;

  cogsStatus: PnlDataStatus;
  statusReasons: string[];
  hasEstimatedChannelAllocation: boolean;
  estimatedAllocationCount: number;
  sourcesUsed: {
    posSummaryCount: number;
    manualSalesCount: number;
    deduplicatedManualSkippedCount: number;
  };
}

/**
 * Evaluates USALI Prime Cost % and Labor % benchmark statuses:
 * - Prime Cost % target <= 65% (warning 65-70%, danger > 70%)
 * - Labor % target <= 30% (warning 30-35%, danger > 35%)
 */
export function getPrimeCostStatus(primeCostPercent: number): BenchmarkStatus {
  if (primeCostPercent <= 65) return 'good';
  if (primeCostPercent <= 70) return 'warning';
  return 'danger';
}

export function getLaborCostStatus(laborPercent: number): BenchmarkStatus {
  if (laborPercent <= 30) return 'good';
  if (laborPercent <= 35) return 'warning';
  return 'danger';
}

/**
 * Single Source of Truth for Period Profit & Loss Statement (P&L).
 * Line sequence:
 *   netSalesExVat (+ retainedSC) -> foodCogs -> packagingCogs -> grossProfit
 *   -> channelFees -> totalLabor (kitchenLabor + fohLabor) -> opex
 *   -> operatingProfit -> estimatedTax (0 if operatingProfit <= 0) -> netProfit
 * Prime Cost = Total COGS (food + packaging) + Total Labor (all active staff).
 */
export function buildPeriodPnl(input: BuildPeriodPnlInput): PeriodPnlResult {
  const {
    summaries,
    manualSales = [],
    expenses,
    employees,
    period,
    dateParam,
    settings,
    cogsMode,
    stockCountSnapshots,
    purchases,
    wasteLog,
    ingredients,
    salesOrders = [],
    todayDate,
    actualCogsInput,
    manualFallbackRates,
  } = input;

  const periodSummaries = summaries.filter((s) => isDateInPeriod(s.date, period, dateParam));
  const periodManual = manualSales.filter((r) => isDateInPeriod(r.date, period, dateParam));

  let netSalesExVatRaw = 0;
  let grossSalesRefRaw = 0;
  let discountsRefRaw = 0;
  let refundsRefRaw = 0;
  let serviceChargeCollectedRaw = 0;
  let vatTotalRaw = 0;
  let orderCount = 0;
  let channelFeesRaw = 0;

  let posFoodCogsRaw = 0;
  let posPackagingCogsRaw = 0;

  const posDatesAll = new Set<string>();
  const posDateChannelKeys = new Set<string>();
  const posWholeDateCovered = new Set<string>();

  // Identify manual records explicitly chosen to override POS for a (date, channel),
  // POS sync entries, and dedicated online order sync entries (web_sync_*)
  const posSyncEntries = periodManual.filter((r) => r.id?.startsWith('pos_sync_'));
  const webSyncEntries = periodManual.filter((r) => r.id?.startsWith('web_sync_'));
  const manualOnlyEntries = periodManual.filter(
    (r) => !r.id?.startsWith('pos_sync_') && !r.id?.startsWith('web_sync_')
  );
  const replacedPosKeys = new Set<string>();
  for (const rec of manualOnlyEntries) {
    if (rec.replacesPosSync) {
      const normCh = normalizeChannelId(rec.channelId || rec.channelName);
      replacedPosKeys.add(`${rec.date}::${normCh}`);
    }
  }

  let estimatedAllocationCount = 0;

  for (const s of periodSummaries) {
    const activeChannels = Object.entries(s.channelTotals || {}).filter(
      ([, v]) => (v?.netSales || 0) > 0 || (v?.orderCount || 0) > 0
    );

    if (activeChannels.length === 0 && replacedPosKeys.has(`${s.date}::dine_in`)) {
      // Whole-day summary replaced by manual dine_in override — do not double count
      continue;
    }

    posDatesAll.add(s.date);
    let summaryNet = Math.max(0, s.netSales || 0);
    let summaryGross = Math.max(0, s.grossSales || 0);
    let summaryDisc = Math.max(0, s.discounts || 0);
    let summarySc = Math.max(0, s.serviceCharge || 0);
    let summaryOrders = Math.max(0, s.orderCount || 0);
    let summaryFees = Math.max(0, s.platformFees || 0);
    let summaryFoodCogs = Math.max(0, s.totalFoodCost || 0);
    let summaryPkgCogs = Math.max(0, s.packagingCost || 0);

    if (activeChannels.length > 0) {
      const totalChNet = activeChannels.reduce((acc, [, v]) => acc + Math.max(0, v?.netSales || 0), 0);
      for (const [ch, chVal] of activeChannels) {
        const key = `${s.date}::${normalizeChannelId(ch)}`;
        if (replacedPosKeys.has(key)) {
          // Deduct this channel's POS share so the manual override replaces it cleanly
          const share = totalChNet > 0 ? Math.max(0, chVal?.netSales || 0) / totalChNet : 1 / activeChannels.length;
          summaryNet = Math.max(0, summaryNet - Math.max(0, chVal?.netSales || 0));
          summaryOrders = Math.max(0, summaryOrders - Math.max(0, chVal?.orderCount || 0));
          summaryGross = Math.max(
            0,
            summaryGross -
              (typeof chVal?.grossSales === 'number' ? chVal.grossSales : summaryGross * share)
          );
          summaryDisc = Math.max(
            0,
            summaryDisc -
              (typeof chVal?.discounts === 'number' ? chVal.discounts : summaryDisc * share)
          );
          summaryFees = Math.max(
            0,
            summaryFees -
              (typeof chVal?.platformFees === 'number' ? chVal.platformFees : 0)
          );
          summarySc = Math.max(
            0,
            summarySc -
              (typeof chVal?.serviceCharge === 'number' ? chVal.serviceCharge : summarySc * share)
          );
          summaryFoodCogs = Math.max(
            0,
            summaryFoodCogs -
              (typeof chVal?.totalFoodCost === 'number' ? chVal.totalFoodCost : summaryFoodCogs * share)
          );
          summaryPkgCogs = Math.max(
            0,
            summaryPkgCogs -
              (typeof chVal?.packagingCost === 'number' ? chVal.packagingCost : summaryPkgCogs * share)
          );
        } else {
          posDateChannelKeys.add(key);
        }
      }
    } else if ((s.netSales || 0) > 0 || (s.orderCount || 0) > 0) {
      posWholeDateCovered.add(s.date);
    }

    netSalesExVatRaw += summaryNet;
    grossSalesRefRaw += summaryGross;
    discountsRefRaw += summaryDisc;
    serviceChargeCollectedRaw += summarySc;
    vatTotalRaw += Math.max(0, s.vat || 0);
    orderCount += summaryOrders;
    channelFeesRaw += summaryFees;
    posFoodCogsRaw += summaryFoodCogs;
    posPackagingCogsRaw += summaryPkgCogs;
  }

  // Add SaleOrder food/packaging COGS ONLY for dates not already covered by POS dailySummaries (avoid double-counting)
  let unmatchedOrderFoodCogsRaw = 0;
  let unmatchedOrderPackagingCogsRaw = 0;
  for (const order of salesOrders) {
    if (!order || !isDateInPeriod(order.date, period, dateParam)) continue;
    if (order.orderStatus === 'CANCELLED' || order.paymentStatus === 'VOID' || order.paymentStatus === 'REFUNDED') {
      continue;
    }
    if (posDatesAll.has(order.date)) continue;
    unmatchedOrderFoodCogsRaw += Math.max(0, order.totalFoodCost || 0);
    unmatchedOrderPackagingCogsRaw += Math.max(0, order.packagingCost || 0);
  }

  let manualSalesCount = 0;
  let deduplicatedManualSkippedCount = 0;
  let manualExplicitFoodCogsRaw = 0;
  let manualExplicitPackagingCogsRaw = 0;
  let manualSalesWithoutCogsRaw = 0;
  let manualSalesWithExplicitCogsCount = 0;

  const resolveRecordNetSalesExVat = (rec: DailySalesRecord): number => {
    if (typeof rec.netSales === 'number' && Number.isFinite(rec.netSales)) {
      return Math.max(0, rec.netSales);
    }
    const nominal = Math.max(0, (rec.grossSales || 0) - (rec.discounts || 0) - (rec.refunds || 0));
    const vatPct = rec.vatRatePercent ?? settings.vatPercent ?? 7;
    if (rec.isVatInclusive && vatPct > 0) {
      return nominal / (1 + vatPct / 100);
    }
    return nominal;
  };

  for (const rec of posSyncEntries) {
    const normCh = normalizeChannelId(rec.channelId || rec.channelName);
    const key = `${rec.date}::${normCh}`;
    if (posDatesAll.has(rec.date) || posDateChannelKeys.has(key) || replacedPosKeys.has(key)) {
      deduplicatedManualSkippedCount += 1;
      continue;
    }
    const recNet = resolveRecordNetSalesExVat(rec);
    posDateChannelKeys.add(key);
    netSalesExVatRaw += recNet;
    grossSalesRefRaw += Math.max(0, rec.grossSales || 0);
    discountsRefRaw += Math.max(0, rec.discounts || 0);
    refundsRefRaw += Math.max(0, rec.refunds || 0);
    serviceChargeCollectedRaw += Math.max(0, rec.serviceCharge || 0);
    orderCount += Math.max(0, rec.orderCount || 0);
    channelFeesRaw += Math.max(0, rec.platformFees || 0);
    if (rec.estimatedAllocation) {
      estimatedAllocationCount += 1;
    }
    if (typeof rec.foodCost === 'number') {
      manualExplicitFoodCogsRaw += Math.max(0, rec.foodCost);
      manualExplicitPackagingCogsRaw += Math.max(0, rec.packagingCost || 0);
      manualSalesWithExplicitCogsCount += 1;
    } else if (recNet > 0) {
      manualSalesWithoutCogsRaw += recNet;
    }
    manualSalesCount += 1;
  }

  // Always include online order sync records (web_sync_*) even if POS dailySummaries exist on the same date
  for (const rec of webSyncEntries) {
    const recNet = resolveRecordNetSalesExVat(rec);
    netSalesExVatRaw += recNet;
    grossSalesRefRaw += Math.max(0, rec.grossSales || 0);
    discountsRefRaw += Math.max(0, rec.discounts || 0);
    refundsRefRaw += Math.max(0, rec.refunds || 0);
    serviceChargeCollectedRaw += Math.max(0, rec.serviceCharge || 0);
    orderCount += Math.max(0, rec.orderCount || 0);
    channelFeesRaw += Math.max(0, rec.platformFees || 0);
    if (typeof rec.foodCost === 'number') {
      manualExplicitFoodCogsRaw += Math.max(0, rec.foodCost);
      manualExplicitPackagingCogsRaw += Math.max(0, rec.packagingCost || 0);
      manualSalesWithExplicitCogsCount += 1;
    } else if (recNet > 0) {
      manualSalesWithoutCogsRaw += recNet;
    }
    manualSalesCount += 1;
  }

  for (const rec of manualOnlyEntries) {
    const normCh = normalizeChannelId(rec.channelId || rec.channelName);
    const key = `${rec.date}::${normCh}`;
    if (!rec.replacesPosSync && (posWholeDateCovered.has(rec.date) || posDateChannelKeys.has(key))) {
      deduplicatedManualSkippedCount += 1;
      continue;
    }
    const recNet = resolveRecordNetSalesExVat(rec);
    netSalesExVatRaw += recNet;
    grossSalesRefRaw += Math.max(0, rec.grossSales || 0);
    discountsRefRaw += Math.max(0, rec.discounts || 0);
    refundsRefRaw += Math.max(0, rec.refunds || 0);
    serviceChargeCollectedRaw += Math.max(0, rec.serviceCharge || 0);
    orderCount += Math.max(0, rec.orderCount || 0);
    channelFeesRaw += Math.max(0, rec.platformFees || 0);
    if (rec.estimatedAllocation) {
      estimatedAllocationCount += 1;
    }
    if (typeof rec.foodCost === 'number') {
      manualExplicitFoodCogsRaw += Math.max(0, rec.foodCost);
      manualExplicitPackagingCogsRaw += Math.max(0, rec.packagingCost || 0);
      manualSalesWithExplicitCogsCount += 1;
    } else if (recNet > 0) {
      manualSalesWithoutCogsRaw += recNet;
    }
    manualSalesCount += 1;
  }

  const scTreatment = settings.serviceChargeTreatment || 'staff_pool';
  const retainedServiceChargeRaw = scTreatment === 'retained' ? serviceChargeCollectedRaw : 0;
  const totalRevenueRaw = netSalesExVatRaw + retainedServiceChargeRaw;

  // Date-scoped Stock Snapshot, Purchases (Food vs Packaging), and Waste Resolution
  const { periodStart, periodEnd } = getPeriodDateBounds(period, dateParam);
  const snapshotRes = resolveStockCountSnapshotsForPeriod(
    stockCountSnapshots || [],
    periodStart,
    periodEnd,
    todayDate
  );
  const purchaseRes = filterPeriodPurchases(purchases || [], periodStart, periodEnd, ingredients);
  const wasteRes =
    wasteLog !== undefined
      ? filterPeriodWaste(wasteLog, periodStart, periodEnd)
      : { periodWaste: [], totalWasteCost: Math.max(0, actualCogsInput?.waste || 0) };

  const theoreticalFoodCogsRaw =
    posFoodCogsRaw + unmatchedOrderFoodCogsRaw + manualExplicitFoodCogsRaw;
  const theoreticalPackagingCogsRaw =
    posPackagingCogsRaw + unmatchedOrderPackagingCogsRaw + manualExplicitPackagingCogsRaw;

  // Actual COGS = Beginning Stock + Period Food Purchases - Ending Stock (Waste NOT subtracted!)
  let actualFoodCogsRaw: number | null = null;
  let periodFoodPurchasesRaw = purchaseRes.totalFoodPurchases;
  const periodPackagingPurchasesExcludedRaw = purchaseRes.totalPackagingPurchases;

  if (snapshotRes.hasCompletePair && snapshotRes.beginningSnapshot && snapshotRes.endingSnapshot) {
    actualFoodCogsRaw =
      snapshotRes.beginningSnapshot.totalValue +
      periodFoodPurchasesRaw -
      snapshotRes.endingSnapshot.totalValue;
  } else if (
    stockCountSnapshots === undefined &&
    actualCogsInput &&
    Boolean(actualCogsInput.hasActualData) &&
    actualCogsInput.beginningInventory !== undefined &&
    actualCogsInput.beginningInventory !== null &&
    Number.isFinite(actualCogsInput.beginningInventory) &&
    actualCogsInput.endingInventory !== undefined &&
    actualCogsInput.endingInventory !== null &&
    Number.isFinite(actualCogsInput.endingInventory)
  ) {
    const legacyPurch = purchases !== undefined ? periodFoodPurchasesRaw : actualCogsInput.purchases || 0;
    periodFoodPurchasesRaw = legacyPurch;
    actualFoodCogsRaw =
      actualCogsInput.beginningInventory + legacyPurch - actualCogsInput.endingInventory;
  }

  // Uncosted manual sales warning
  const uncostedManualSalesAmount = roundTo2(manualSalesWithoutCogsRaw);
  const uncostedManualSalesWarning =
    uncostedManualSalesAmount > 0
      ? `มียอดขาย manual ${uncostedManualSalesAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} บาทที่ไม่มีต้นทุนอาหารคู่ อาจทำให้กำไรสูงเกินจริง`
      : null;

  // COGS Resolution (strictly Rule 2: never silently invent fake cost rates)
  let foodCogsRaw = 0;
  let packagingCogsRaw = 0;
  let cogsStatus: PnlDataStatus = 'complete';
  let cogsSource: 'actual' | 'theoretical' = 'theoretical';
  let cogsLabel = snapshotRes.hasCompletePair
    ? 'ต้นทุนจริงจากการนับสต็อก (Actual COGS)'
    : 'ประมาณการจากสูตร ยังไม่มีการนับสต็อก';
  const statusReasons: string[] = [];

  if (cogsMode === 'actual') {
    if (actualFoodCogsRaw !== null) {
      foodCogsRaw = actualFoodCogsRaw;
      packagingCogsRaw =
        actualCogsInput?.packagingFromOrders !== undefined
          ? actualCogsInput.packagingFromOrders
          : theoreticalPackagingCogsRaw;
      cogsSource = 'actual';
      cogsLabel = 'ต้นทุนจริงจากการนับสต็อก (Actual COGS)';
      if (foodCogsRaw < 0) {
        cogsStatus = 'incomplete';
        statusReasons.push('ต้นทุนสต็อกติดลบ กรุณาตรวจสอบสต็อกต้นงวด/ปลายงวด');
      }
    } else {
      cogsStatus = 'incomplete';
      cogsSource = 'theoretical';
      cogsLabel = 'ประมาณการจากสูตร ยังไม่มีการนับสต็อก';
      statusReasons.push('ประมาณการจากสูตร ยังไม่มีการนับสต็อก');
      foodCogsRaw = theoreticalFoodCogsRaw;
      packagingCogsRaw = theoreticalPackagingCogsRaw;
    }
  } else {
    // 'estimated' / operational mode: POS summary snapshots + explicit manual COGS + optional real-menu-recipe rate
    foodCogsRaw = theoreticalFoodCogsRaw;
    packagingCogsRaw = theoreticalPackagingCogsRaw;
    cogsSource = 'theoretical';

    if (manualSalesWithoutCogsRaw > 0) {
      const ratePct = manualFallbackRates?.foodCostPercent;
      if (typeof ratePct === 'number' && Number.isFinite(ratePct) && ratePct > 0) {
        foodCogsRaw += manualSalesWithoutCogsRaw * (ratePct / 100);
        const pkgPct = manualFallbackRates?.packagingPercent;
        if (typeof pkgPct === 'number' && Number.isFinite(pkgPct) && pkgPct > 0) {
          packagingCogsRaw += manualSalesWithoutCogsRaw * (pkgPct / 100);
        }
        cogsStatus = 'estimated';
        statusReasons.push('ใช้ % ต้นทุนอาหารเฉลี่ยจากสูตรเมนูสำหรับยอดขายกรอกมือ');
      } else {
        cogsStatus = 'incomplete';
        statusReasons.push('มียอดขายกรอกมือที่ยังไม่มีข้อมูลต้นทุน (COGS)');
      }
    } else if (periodSummaries.length === 0 && manualSalesCount === 0 && totalRevenueRaw === 0) {
      cogsStatus = 'complete';
    }
  }

  if (uncostedManualSalesWarning) {
    statusReasons.push(uncostedManualSalesWarning);
  }

  // Variance against Theoretical Food COGS using % of Net Sales threshold
  const thresholdPercent =
    typeof settings.cogsVarianceThresholdPercent === 'number' &&
    Number.isFinite(settings.cogsVarianceThresholdPercent)
      ? settings.cogsVarianceThresholdPercent
      : 3.0;
  const varianceResult =
    actualFoodCogsRaw !== null
      ? calculateVariance(actualFoodCogsRaw, theoreticalFoodCogsRaw, netSalesExVatRaw, thresholdPercent)
      : {
          varianceAmount: 0,
          variancePercent: 0,
          variancePercentOfSales: 0,
          thresholdPercent,
          varianceStatus: 'ON_TRACK' as const,
        };

  // Expenses & Labor (date-bound allocator, unrounded floats)
  const allocated = allocatePeriodExpensesAndLaborRaw(
    period,
    dateParam,
    expenses,
    employees,
    periodSummaries,
    {
      socialSecurityEnabled: settings.socialSecurityEnabled,
      socialSecurityRatePercent: settings.socialSecurityRatePercent,
      socialSecurityCapWage: settings.socialSecurityCapWage,
    }
  );

  const totalCogsRaw = foodCogsRaw + packagingCogsRaw;
  const grossProfitRaw = totalRevenueRaw - totalCogsRaw;

  const totalLaborRaw = allocated.laborCost;
  const kitchenLaborRaw = allocated.kitchenLaborCost;
  const fohLaborRaw = allocated.fohLaborCost;
  const opexRaw = allocated.operatingExpenses;

  // Prime Cost = Total COGS (food + packaging) + Total Labor (all active staff)
  const primeCostRaw = totalCogsRaw + totalLaborRaw;

  // Operating Profit = Gross Profit - Channel Fees - Total Labor - OPEX
  const operatingProfitRaw = grossProfitRaw - channelFeesRaw - totalLaborRaw - opexRaw;

  const taxRatePercent =
    typeof settings.incomeTaxRatePercent === 'number' && Number.isFinite(settings.incomeTaxRatePercent)
      ? Math.max(0, settings.incomeTaxRatePercent)
      : 20;

  const estimatedTaxRaw =
    operatingProfitRaw > 0 && taxRatePercent > 0 ? operatingProfitRaw * (taxRatePercent / 100) : 0;
  const netProfitRaw = operatingProfitRaw - estimatedTaxRaw;

  const netSalesExVat = roundTo2(netSalesExVatRaw);
  const totalRevenue = roundTo2(totalRevenueRaw);
  const foodCogs = roundTo2(foodCogsRaw);
  const packagingCogs = roundTo2(packagingCogsRaw);
  const totalCogs = roundTo2(totalCogsRaw);
  const grossProfit = roundTo2(grossProfitRaw);
  const channelFees = roundTo2(channelFeesRaw);
  const totalLabor = roundTo2(totalLaborRaw);
  const kitchenLabor = roundTo2(kitchenLaborRaw);
  const fohLabor = roundTo2(fohLaborRaw);
  const opex = roundTo2(opexRaw);
  const operatingProfit = roundTo2(operatingProfitRaw);
  const estimatedTax = roundTo2(estimatedTaxRaw);
  const netProfit = roundTo2(netProfitRaw);
  const primeCost = roundTo2(primeCostRaw);

  const primeCostPercent = totalRevenueRaw > 0 ? roundTo2((primeCostRaw / totalRevenueRaw) * 100) : 0;
  const laborPercent = totalRevenueRaw > 0 ? roundTo2((totalLaborRaw / totalRevenueRaw) * 100) : 0;
  const foodCostPercent = netSalesExVatRaw > 0 ? roundTo2((foodCogsRaw / netSalesExVatRaw) * 100) : 0;
  const grossMarginPercent = totalRevenueRaw > 0 ? roundTo2((grossProfitRaw / totalRevenueRaw) * 100) : 0;
  const operatingMarginPercent =
    totalRevenueRaw > 0 ? roundTo2((operatingProfitRaw / totalRevenueRaw) * 100) : 0;
  const netMarginPercent = totalRevenueRaw > 0 ? roundTo2((netProfitRaw / totalRevenueRaw) * 100) : 0;
  const avgOrderValue = orderCount > 0 ? roundTo2(netSalesExVatRaw / orderCount) : 0;

  return {
    period,
    dateParam,
    daysInPeriod: allocated.daysInPeriod,
    coveredMonths: allocated.coveredMonths,

    grossSalesRef: roundTo2(grossSalesRefRaw),
    discountsRef: roundTo2(discountsRefRaw),
    refundsRef: roundTo2(refundsRefRaw),
    serviceChargeCollected: roundTo2(serviceChargeCollectedRaw),
    retainedServiceCharge: roundTo2(retainedServiceChargeRaw),
    vatTotal: roundTo2(vatTotalRaw),
    orderCount,
    avgOrderValue,

    netSalesExVat,
    totalRevenue,
    foodCogs,
    packagingCogs,
    totalCogs,
    grossProfit,
    grossMarginPercent,

    channelFees,

    totalLabor,
    kitchenLabor,
    fohLabor,
    laborPercent,
    laborStatus: getLaborCostStatus(laborPercent),

    opex,
    fixedExpenses: roundTo2(allocated.fixedExpenses),
    variableExpenses: roundTo2(allocated.variableExpenses),

    operatingProfit,
    operatingMarginPercent,

    taxRatePercent,
    estimatedTax,
    netProfit,
    netMarginPercent,

    primeCost,
    primeCostPercent,
    primeCostStatus: getPrimeCostStatus(primeCostPercent),

    foodCostPercent,

    theoreticalFoodCogs: roundTo2(theoreticalFoodCogsRaw),
    actualFoodCogs: actualFoodCogsRaw !== null ? roundTo2(actualFoodCogsRaw) : null,
    cogsSource,
    cogsLabel,
    hasCompleteStockSnapshots: snapshotRes.hasCompletePair,
    beginningStockSnapshot: snapshotRes.beginningSnapshot,
    endingStockSnapshot: snapshotRes.endingSnapshot,
    periodFoodPurchases: roundTo2(periodFoodPurchasesRaw),
    periodPackagingPurchasesExcluded: roundTo2(periodPackagingPurchasesExcludedRaw),
    wasteMemo: roundTo2(wasteRes.totalWasteCost),
    varianceAmount: varianceResult.varianceAmount,
    variancePercent: varianceResult.variancePercent,
    variancePercentOfSales: varianceResult.variancePercentOfSales,
    varianceStatus: varianceResult.varianceStatus,
    uncostedManualSalesAmount,
    uncostedManualSalesWarning,

    cogsStatus,
    statusReasons,
    hasEstimatedChannelAllocation: estimatedAllocationCount > 0,
    estimatedAllocationCount,
    sourcesUsed: {
      posSummaryCount: periodSummaries.length,
      manualSalesCount: manualSalesCount + manualSalesWithExplicitCogsCount * 0,
      deduplicatedManualSkippedCount,
    },
  };
}

/**
 * Centralized USALI Profit & Loss (Income Statement) computation from Daily Summaries,
 * allocated expenses, labor, and accounting settings.
 * Preserved for backwards compatibility (ReportsPage, DashboardPage) and aligned with buildPeriodPnl.
 */
export function calculateUsaliPnl(
  summaries: DailySummaryDoc[],
  periodExpensesAndLabor: {
    fixedExpenses: number;
    variableExpenses: number;
    operatingExpenses: number;
    laborCost: number;
    daysInPeriod: number;
    coveredMonths: number;
  },
  serviceChargeTreatment: 'staff_pool' | 'retained' = 'staff_pool'
): UsaliPnlResult {
  let netSalesRaw = 0;
  let grossSalesRaw = 0;
  let discountsRaw = 0;
  let totalFoodCostRaw = 0;
  let platformFeesRaw = 0;
  let packagingCostRaw = 0;
  let serviceChargeCollectedRaw = 0;
  let vatTotalRaw = 0;
  let orderCount = 0;

  for (const s of summaries) {
    netSalesRaw += s.netSales || 0;
    grossSalesRaw += s.grossSales || 0;
    discountsRaw += s.discounts || 0;
    totalFoodCostRaw += s.totalFoodCost || 0;
    platformFeesRaw += s.platformFees || 0;
    packagingCostRaw += s.packagingCost || 0;
    serviceChargeCollectedRaw += s.serviceCharge || 0;
    vatTotalRaw += s.vat || 0;
    orderCount += s.orderCount || 0;
  }

  const retainedServiceChargeRaw = serviceChargeTreatment === 'retained' ? serviceChargeCollectedRaw : 0;
  const totalRevenueRaw = netSalesRaw + retainedServiceChargeRaw;

  const {
    fixedExpenses,
    variableExpenses,
    operatingExpenses,
    laborCost,
    daysInPeriod,
    coveredMonths,
  } = periodExpensesAndLabor;

  const grossProfitRaw = totalRevenueRaw - totalFoodCostRaw - packagingCostRaw;
  const primeCostRaw = totalFoodCostRaw + packagingCostRaw + laborCost;
  const netOperatingProfitRaw = grossProfitRaw - platformFeesRaw - laborCost - operatingExpenses;

  const netSales = roundTo2(netSalesRaw);
  const totalRevenue = roundTo2(totalRevenueRaw);
  const totalFoodCost = roundTo2(totalFoodCostRaw);
  const packagingCost = roundTo2(packagingCostRaw);
  const platformFees = roundTo2(platformFeesRaw);
  const grossProfit = roundTo2(grossProfitRaw);
  const primeCost = roundTo2(primeCostRaw);
  const netOperatingProfit = roundTo2(netOperatingProfitRaw);

  const theoreticalFoodCostPercent = netSalesRaw > 0 ? roundTo2((totalFoodCostRaw / netSalesRaw) * 100) : 0;
  const grossProfitMarginPercent = totalRevenueRaw > 0 ? roundTo2((grossProfitRaw / totalRevenueRaw) * 100) : 0;
  const primeCostPercent = totalRevenueRaw > 0 ? roundTo2((primeCostRaw / totalRevenueRaw) * 100) : 0;
  const laborPercent = totalRevenueRaw > 0 ? roundTo2((laborCost / totalRevenueRaw) * 100) : 0;
  const netProfitMarginPercent = totalRevenueRaw > 0 ? roundTo2((netOperatingProfitRaw / totalRevenueRaw) * 100) : 0;
  const avgOrderValue = orderCount > 0 ? roundTo2(netSalesRaw / orderCount) : 0;

  return {
    netSales,
    retainedServiceCharge: roundTo2(retainedServiceChargeRaw),
    totalRevenue,
    totalFoodCost,
    theoreticalFoodCostPercent,
    grossProfit,
    grossProfitMarginPercent,
    packagingCost,
    platformFees,
    laborCost: roundTo2(laborCost),
    laborPercent,
    laborStatus: getLaborCostStatus(laborPercent),
    fixedExpenses: roundTo2(fixedExpenses),
    variableExpenses: roundTo2(variableExpenses),
    operatingExpenses: roundTo2(operatingExpenses),
    primeCost,
    primeCostPercent,
    primeCostStatus: getPrimeCostStatus(primeCostPercent),
    netOperatingProfit,
    netProfitMarginPercent,
    orderCount,
    avgOrderValue,
    grossSales: roundTo2(grossSalesRaw),
    discounts: roundTo2(discountsRaw),
    vatTotal: roundTo2(vatTotalRaw),
    serviceChargeCollected: roundTo2(serviceChargeCollectedRaw),
    coveredMonths,
    daysInPeriod,
  };
}

export interface DeriveVariableCostOptions {
  /** Total monthly/period variable operating expenses (isFixed === false, excluding payroll duplicates) */
  otherVariableCostAmount?: number;
  /** Denominator net sales ex-VAT corresponding to otherVariableCostAmount (defaults to recentSummaries totalNetSales) */
  otherVariablePeriodNetSales?: number;
  /** Precomputed other variable expense % of sales if caller already normalized it */
  extraVariablePercent?: number;
}

export interface DerivedVariableCostResult {
  foodCostPercent: number;
  packagingPercent: number;
  platformFeePercent: number;
  otherVariableCostPercent: number;
  variableCostPercent: number;
  contributionMarginPercent: number;
  hasRealData: boolean;
  isAssumed: boolean;
  totalNetSales: number;
}

/**
 * Derives variable cost % and Contribution Margin % strictly from real data:
 *   variableCost% = foodCost% + packaging% + platformFee% + otherVariableCost%
 *   CM% = 100 - variableCost%
 * When no real data exists, returns hasRealData = false, isAssumed = true, CM% = 0
 * (never silently fabricating 35% / 65%).
 */
export function deriveVariableCostPercent(
  recentSummaries: DailySummaryDoc[],
  options?: DeriveVariableCostOptions
): DerivedVariableCostResult {
  let netSales = 0;
  let foodCosts = 0;
  let packagingCosts = 0;
  let platformFees = 0;

  for (const s of recentSummaries) {
    netSales += Math.max(0, s.netSales || 0);
    foodCosts += Math.max(0, s.totalFoodCost || 0);
    packagingCosts += Math.max(0, s.packagingCost || 0);
    platformFees += Math.max(0, s.platformFees || 0);
  }

  const baseCosts = foodCosts + packagingCosts + platformFees;
  const otherVarAmount = Math.max(0, options?.otherVariableCostAmount || 0);
  const otherVarDenom =
    options?.otherVariablePeriodNetSales && options.otherVariablePeriodNetSales > 0
      ? options.otherVariablePeriodNetSales
      : netSales;

  const extraPct =
    typeof options?.extraVariablePercent === 'number' && Number.isFinite(options.extraVariablePercent)
      ? Math.max(0, options.extraVariablePercent)
      : null;

  if (netSales > 0 && (baseCosts > 0 || otherVarAmount > 0 || (extraPct ?? 0) > 0)) {
    const foodPctRaw = (foodCosts / netSales) * 100;
    const pkgPctRaw = (packagingCosts / netSales) * 100;
    const feePctRaw = (platformFees / netSales) * 100;
    const otherVarPctRaw =
      extraPct !== null
        ? extraPct
        : otherVarAmount > 0 && otherVarDenom > 0
        ? (otherVarAmount / otherVarDenom) * 100
        : 0;

    const totalVarRaw = foodPctRaw + pkgPctRaw + feePctRaw + otherVarPctRaw;
    const cmRaw = Math.max(0, Math.min(100, 100 - totalVarRaw));

    return {
      foodCostPercent: roundTo2(foodPctRaw),
      packagingPercent: roundTo2(pkgPctRaw),
      platformFeePercent: roundTo2(feePctRaw),
      otherVariableCostPercent: roundTo2(otherVarPctRaw),
      variableCostPercent: roundTo2(totalVarRaw),
      contributionMarginPercent: roundTo2(cmRaw),
      hasRealData: true,
      isAssumed: false,
      totalNetSales: roundTo2(netSales),
    };
  }

  return {
    foodCostPercent: 0,
    packagingPercent: 0,
    platformFeePercent: 0,
    otherVariableCostPercent: 0,
    variableCostPercent: 0,
    contributionMarginPercent: 0,
    hasRealData: false,
    isAssumed: true,
    totalNetSales: roundTo2(netSales),
  };
}

/**
 * Calculates simple monthly & daily **ex-VAT** break-even net sales from monthly fixed overhead & labor:
 * Break-even Sales (ex-VAT) = (Monthly Fixed Expenses + Monthly Labor Cost) / (Contribution Margin % / 100)
 * Daily Break-even (ex-VAT) = Monthly Break-even / Operating Days
 */
export function calculateSimpleMonthlyBreakEven(
  monthlyFixedExpenses: number,
  monthlyLaborCost: number,
  contributionMarginPercent: number,
  operatingDays: number = 30
): {
  totalFixedOverhead: number;
  monthlyBreakEvenSales: number;
  dailyBreakEvenSales: number;
  contributionMarginPercent: number;
  operatingDays: number;
} {
  const totalFixedOverhead = monthlyFixedExpenses + monthlyLaborCost;
  const marginRatio = contributionMarginPercent > 0 ? contributionMarginPercent / 100 : 0;
  const days = operatingDays > 0 ? operatingDays : 30;

  if (marginRatio <= 0) {
    return {
      totalFixedOverhead: roundTo2(totalFixedOverhead),
      monthlyBreakEvenSales: 0,
      dailyBreakEvenSales: 0,
      contributionMarginPercent,
      operatingDays: days,
    };
  }

  const monthlyBreakEvenSales = totalFixedOverhead / marginRatio;
  const dailyBreakEvenSales = monthlyBreakEvenSales / days;

  return {
    totalFixedOverhead: roundTo2(totalFixedOverhead),
    monthlyBreakEvenSales: roundTo2(monthlyBreakEvenSales),
    dailyBreakEvenSales: roundTo2(dailyBreakEvenSales),
    contributionMarginPercent,
    operatingDays: days,
  };
}

/**
 * Calculates member loyalty points earned for a bill.
 */
export function calculatePointsEarned(netSales: number, pointsEarnUnitThb: number): number {
  if (pointsEarnUnitThb <= 0 || netSales <= 0) return 0;
  return Math.floor(netSales / pointsEarnUnitThb);
}

/**
 * Calculates cash change due.
 */
export function calculateChangeDue(tendered: number, due: number): number {
  if (tendered < due) return 0;
  return roundTo2(tendered - due);
}

/**
 * Pure P&L CSV serializer used identically by UnifiedFinanceHubPage export and integration tests.
 * Ensures CSV rows reflect the exact same PeriodPnlResult and Break-Even target shown in the UI.
 */
export function buildPnlCsvRows(
  pnl: PeriodPnlResult,
  monthlyBreakEvenSales: number = 0
): string[][] {
  return [
    ['Metric', 'Amount (THB)'],
    ['Period', `${pnl.period}:${pnl.dateParam}`],
    ['Net Sales (ex-VAT)', roundTo2(pnl.netSalesExVat).toFixed(2)],
    ...(pnl.retainedServiceCharge > 0
      ? [['Retained Service Charge', roundTo2(pnl.retainedServiceCharge).toFixed(2)]]
      : []),
    ['Food COGS', roundTo2(pnl.foodCogs).toFixed(2)],
    ['Packaging COGS', roundTo2(pnl.packagingCogs).toFixed(2)],
    ['Gross Profit', roundTo2(pnl.grossProfit).toFixed(2)],
    ['Gross Margin %', `${pnl.grossMarginPercent.toFixed(1)}%`],
    ['Channel / Platform Fees (GP)', roundTo2(pnl.channelFees).toFixed(2)],
    ['Kitchen Labor', roundTo2(pnl.kitchenLabor).toFixed(2)],
    ['FOH & Management Labor', roundTo2(pnl.fohLabor).toFixed(2)],
    ['Total Labor (All Staff)', roundTo2(pnl.totalLabor).toFixed(2)],
    ['Prime Cost (Total COGS + Total Labor)', roundTo2(pnl.primeCost).toFixed(2)],
    ['Prime Cost %', `${pnl.primeCostPercent.toFixed(1)}%`],
    ['Operating Expenses (OPEX)', roundTo2(pnl.opex).toFixed(2)],
    ['Operating Profit (กำไรจากการดำเนินงาน)', roundTo2(pnl.operatingProfit).toFixed(2)],
    ['Estimated Tax (Confirm with Accountant)', roundTo2(pnl.estimatedTax).toFixed(2)],
    ['Net Profit', roundTo2(pnl.netProfit).toFixed(2)],
    ['COGS Data Status', pnl.cogsStatus],
    ['Monthly Break-Even Target', roundTo2(monthlyBreakEvenSales).toFixed(2)],
  ];
}
