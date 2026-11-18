/**
 * Pure Restaurant Cost & Profit Calculation Engine
 * Separated into pure, reusable, side-effect free mathematical functions.
 */

import { convertUnit, normalizeUnitToken, isPieceLikeUnit } from './units';
import {
  UnitType,
  RecipeItem,
  SubRecipeItem,
  MenuItem,
  PortionVariant,
  SalesChannel,
  DailySalesRecord,
  ExpenseRecord,
  ExpenseFrequency,
} from '../types/domain';

/**
 * 1. Calculate Usable Quantity from Purchase Quantity & Yield %
 * Formula: Usable Quantity = Purchase Quantity * (Yield % / 100)
 */
export function calculateUsableQuantity(purchaseQuantity: number, yieldPercent: number): number {
  if (purchaseQuantity <= 0 || yieldPercent <= 0) return 0;
  return purchaseQuantity * (yieldPercent / 100);
}

/**
 * 2. Calculate Effective Cost per Usable Unit
 * Formula: Effective Cost = Purchase Price / Usable Quantity
 * Returns cost with missingPrice flag; valueOf allows direct arithmetic operations.
 */
export interface EffectiveCostResult {
  cost: number;
  effectiveCost: number;
  missingPrice: boolean;
  valueOf(): number;
}

export function calculateEffectiveCost(
  purchasePrice: number,
  usableQuantity: number
): EffectiveCostResult & number {
  const missingPrice = !purchasePrice || purchasePrice <= 0 || isNaN(purchasePrice);
  const cost = missingPrice || usableQuantity <= 0 ? 0 : purchasePrice / usableQuantity;
  const result: any = {
    cost,
    effectiveCost: cost,
    missingPrice,
    valueOf() {
      return cost;
    },
  };
  return result;
}

/**
 * 3. Calculate Yield Percentage from Raw and Usable Quantity
 * Formula: Yield % = (Usable Quantity / Raw Quantity) * 100
 */
export function calculateYieldPercent(rawQuantity: number, usableQuantity: number): number {
  if (rawQuantity <= 0) return 0;
  return (usableQuantity / rawQuantity) * 100;
}

/**
 * 4. Calculate Cost for an Ingredient usage in recipe
 */
export function calculateItemCost(
  quantityUsed: number,
  recipeUnit: UnitType,
  purchaseUnit: UnitType,
  costPerUsablePurchaseUnit: number,
  density: number = 1.0
): { cost: number; error?: string } {
  if (quantityUsed <= 0 || costPerUsablePurchaseUnit <= 0) {
    return { cost: 0 };
  }

  // Convert recipeUnit to purchaseUnit
  const conv = convertUnit(quantityUsed, recipeUnit, purchaseUnit, density);
  if (!conv.success) {
    return {
      cost: 0,
      error: conv.errorMessageTh || 'หน่วยไม่ตรงกัน',
    };
  }

  const cost = conv.convertedQuantity * costPerUsablePurchaseUnit;
  return { cost };
}

/**
 * 5. Calculate Sub-recipe / Sauce Batch Cost & Cost Per Final Unit
 */
export function calculateSubRecipeBatch(
  items: SubRecipeItem[],
  batchQuantity: number,
  preparationYieldPercent: number
): {
  batchCost: number;
  finalBatchQuantity: number;
  costPerFinalUnit: number;
} {
  const batchCost = items.reduce((sum, item) => sum + (item.extendedCost || 0), 0);
  const finalBatchQuantity = batchQuantity * (preparationYieldPercent / 100);
  const costPerFinalUnit = finalBatchQuantity > 0 ? batchCost / finalBatchQuantity : 0;

  return {
    batchCost,
    finalBatchQuantity,
    costPerFinalUnit,
  };
}

/**
 * 6. Calculate Recipe Direct Cost (SUM of all line items)
 */
export function calculateRecipeDirectCost(items: RecipeItem[]): number {
  return items.reduce((sum, item) => sum + (item.extendedCost || 0), 0);
}

/**
 * 7. Calculate Portion Direct Cost with multiplier or custom overrides
 */
export function calculatePortionCost(
  baseRecipeCost: number,
  portionMultiplier: number = 1.0,
  packagingCost: number = 0,
  customItems?: RecipeItem[]
): {
  directFoodCost: number;
  packagingCost: number;
  totalDirectCost: number;
} {
  const directFoodCost = customItems && customItems.length > 0
    ? calculateRecipeDirectCost(customItems)
    : baseRecipeCost * portionMultiplier;

  const totalDirectCost = directFoodCost + packagingCost;

  return {
    directFoodCost,
    packagingCost,
    totalDirectCost,
  };
}

/**
 * 8. Calculate Food Cost Percentage against a Menu Selling Price
 * Formula: (Food Cost / Selling Price) * 100
 * Tax basis: `sellingPrice` should match the desired ratio basis (pass **ex-VAT** selling price
 * for standard P&L / Food Cost % comparability).
 */
export function calculateSellingPriceFoodCostPercent(foodCost: number, sellingPrice: number): number {
  if (sellingPrice <= 0) return 0;
  return (foodCost / sellingPrice) * 100;
}

/**
 * 9. Calculate Tiered Suggested Selling Prices
 * Method A (Food Cost %): Direct Cost / (Target Food Cost % / 100)
 * Method B (Gross Margin %): Direct Cost / (1 - (Target Gross Margin % / 100))
 * Tax basis: returns **ex-VAT** baseline menu price tiers matching ex-VAT `directCost`.
 * Multiply by `(1 + vatRate)` afterwards if publishing VAT-inclusive menu prices.
 */
export function calculateTieredSuggestedPrices(
  directCost: number,
  targetPercent: number,
  method: 'food_cost_target' | 'gross_margin_target' = 'food_cost_target'
): {
  minimumPrice: number;
  recommendedPrice: number;
  targetPrice: number;
  premiumPrice: number;
} {
  if (directCost <= 0 || targetPercent <= 0) {
    return { minimumPrice: 0, recommendedPrice: 0, targetPrice: 0, premiumPrice: 0 };
  }

  let baseTargetPrice = 0;
  if (method === 'food_cost_target') {
    // e.g. target 30% -> Direct Cost / 0.30
    baseTargetPrice = directCost / (targetPercent / 100);
  } else {
    // e.g. target 70% margin -> Direct Cost / (1 - 0.70)
    const marginRatio = 1 - targetPercent / 100;
    baseTargetPrice = marginRatio > 0 ? directCost / marginRatio : directCost * 3;
  }

  // Common pricing tiers
  const minimumPrice = Math.ceil(directCost / 0.40); // 40% maximum allowable food cost
  const recommendedPrice = Math.ceil(baseTargetPrice);
  const targetPrice = Math.ceil(baseTargetPrice * 1.05);
  const premiumPrice = Math.ceil(baseTargetPrice * 1.25);

  return {
    minimumPrice,
    recommendedPrice,
    targetPrice,
    premiumPrice,
  };
}

/**
 * 10. Calculate Sales Channel Platform Fees & Net Revenue
 * Includes Commission %, Payment fee %, Fixed fee, and 7% VAT on commission
 */
export function calculatePlatformFee(
  sellingPrice: number,
  channel: SalesChannel,
  discount: number = 0
): {
  commissionFee: number;
  commissionTax: number;
  paymentFee: number;
  fixedFee: number;
  totalPlatformFee: number;
  effectivePrice: number;
} {
  const effectivePrice = Math.max(0, sellingPrice - discount);
  const commissionFee = effectivePrice * (channel.commissionPercent / 100);
  const commissionTax = commissionFee * (channel.taxOnCommissionPercent / 100);
  const paymentFee = effectivePrice * (channel.paymentFeePercent / 100);
  const fixedFee = channel.fixedFeePerOrder || 0;

  const totalPlatformFee = commissionFee + commissionTax + paymentFee + fixedFee;

  return {
    commissionFee,
    commissionTax,
    paymentFee,
    fixedFee,
    totalPlatformFee,
    effectivePrice,
  };
}

/**
 * 11. Calculate Net Revenue after discounts and platform fees
 */
export function calculateNetRevenue(
  sellingPrice: number,
  totalPlatformFee: number,
  discount: number = 0,
  packagingSurcharge: number = 0
): number {
  const gross = Math.max(0, sellingPrice - discount) + packagingSurcharge;
  return Math.max(0, gross - totalPlatformFee);
}

/**
 * 12. Calculate Contribution Profit & Contribution Margin %
 * Contribution Profit = Net Revenue - Total Variable/Direct Cost
 * Contribution Margin % = (Contribution Profit / Net Revenue) * 100
 */
export function calculateContributionMetrics(
  netRevenue: number,
  totalDirectCost: number
): {
  contributionProfit: number;
  contributionMarginPercent: number;
} {
  const contributionProfit = netRevenue - totalDirectCost;
  const contributionMarginPercent = netRevenue > 0 ? (contributionProfit / netRevenue) * 100 : 0;

  return {
    contributionProfit,
    contributionMarginPercent,
  };
}

/**
 * 13. Calculate Inventory COGS (Mode B: Accounting)
 * Standard Formula: COGS = Beginning Inventory + Purchases - Ending Inventory
 * Waste has already left ending stock and MUST NOT be subtracted from COGS;
 * if passed, waste is returned only as a separate memo (`wasteMemo`).
 */
export interface InventoryCOGSResult {
  cogs: number;
  rawCogs: number;
  isNegative: boolean;
  wasteMemo: number;
  valueOf(): number;
}

export function calculateInventoryCOGS(
  beginningInventory: number,
  purchases: number,
  endingInventory: number,
  waste: number = 0
): InventoryCOGSResult {
  const raw = beginningInventory + purchases - endingInventory;
  const isNegative = raw < 0;
  const wasteMemo = typeof waste === 'number' && Number.isFinite(waste) ? Math.max(0, waste) : 0;
  return {
    cogs: raw,
    rawCogs: raw,
    isNegative,
    wasteMemo,
    valueOf() {
      return raw;
    },
  };
}

/**
 * 14. Calculate Prime Cost & Prime Cost %
 * Formula: Prime Cost = COGS + Direct Labor
 * Prime Cost % = (Prime Cost / Net Sales) * 100
 */
export function calculatePrimeCostMetrics(
  cogs: number,
  directLaborCost: number,
  netSales: number
): {
  primeCost: number;
  primeCostPercent: number;
} {
  const primeCost = cogs + directLaborCost;
  const primeCostPercent = netSales > 0 ? (primeCost / netSales) * 100 : 0;

  return {
    primeCost,
    primeCostPercent,
  };
}

/**
 * 15. Calculate Profit & Loss Metrics
 */
export function calculateProfitAndLoss(
  grossSales: number,
  discounts: number,
  refunds: number,
  foodCogs: number,
  packagingCogs: number,
  operatingExpenses: number,
  directLabor: number,
  taxRatePercent: number = 20,
  nonKitchenLabor: number = 0,
  channelFees: number = 0,
  netSalesExVatOverride?: number
): {
  netSales: number;
  totalCogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  channelFees: number;
  directLabor: number;
  nonKitchenLabor: number;
  totalLabor: number;
  primeCost: number;
  primeCostPercent: number;
  operatingProfit: number;
  operatingMarginPercent: number;
  taxAmount: number;
  netProfit: number;
  netMarginPercent: number;
} {
  const round2 = (v: number) => (Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0);
  const netSalesRaw =
    typeof netSalesExVatOverride === 'number' && Number.isFinite(netSalesExVatOverride)
      ? Math.max(0, netSalesExVatOverride)
      : Math.max(0, grossSales - discounts - refunds);
  const totalCogsRaw = foodCogs + packagingCogs;
  const grossProfitRaw = netSalesRaw - totalCogsRaw;

  const totalLaborRaw = directLabor + nonKitchenLabor;
  const primeCostRaw = totalCogsRaw + totalLaborRaw;
  const primeCostPercent = netSalesRaw > 0 ? round2((primeCostRaw / netSalesRaw) * 100) : 0;

  const operatingProfitRaw = grossProfitRaw - channelFees - totalLaborRaw - operatingExpenses;
  const grossMarginPercent = netSalesRaw > 0 ? round2((grossProfitRaw / netSalesRaw) * 100) : 0;
  const operatingMarginPercent = netSalesRaw > 0 ? round2((operatingProfitRaw / netSalesRaw) * 100) : 0;

  // Tax on positive operating profit only
  const effectiveTaxRate = Math.max(0, taxRatePercent || 0);
  const taxAmountRaw = operatingProfitRaw > 0 && effectiveTaxRate > 0 ? operatingProfitRaw * (effectiveTaxRate / 100) : 0;
  const netProfitRaw = operatingProfitRaw - taxAmountRaw;
  const netMarginPercent = netSalesRaw > 0 ? round2((netProfitRaw / netSalesRaw) * 100) : 0;

  return {
    netSales: round2(netSalesRaw),
    totalCogs: round2(totalCogsRaw),
    grossProfit: round2(grossProfitRaw),
    grossMarginPercent,
    channelFees: round2(channelFees),
    directLabor: round2(directLabor),
    nonKitchenLabor: round2(nonKitchenLabor),
    totalLabor: round2(totalLaborRaw),
    primeCost: round2(primeCostRaw),
    primeCostPercent,
    operatingProfit: round2(operatingProfitRaw),
    operatingMarginPercent,
    taxAmount: round2(taxAmountRaw),
    netProfit: round2(netProfitRaw),
    netMarginPercent,
  };
}

/**
 * 15.1 Calculate Asset Monthly Expense (Depreciation vs Installment Exclusivity)
 * Rule: Straight-line depreciation = price ÷ life in years ÷ 12.
 * If an asset is on installment, use the monthly installment INSTEAD (never both).
 */
export function calculateAssetMonthlyExpense(asset: {
  isInstallment?: boolean;
  monthlyInstallment?: number;
  assetCost?: number;
  usefulLifeYears?: number;
}): number {
  if (asset.isInstallment || (asset.monthlyInstallment && asset.monthlyInstallment > 0)) {
    return Math.max(0, asset.monthlyInstallment || 0);
  }
  if (asset.assetCost && asset.assetCost > 0 && asset.usefulLifeYears && asset.usefulLifeYears > 0) {
    return asset.assetCost / (asset.usefulLifeYears * 12);
  }
  return 0;
}

/**
 * 15.2 Convert Expense Record to Monthly Amount
 * Standard conversion rules:
 * - monthly: amount * 1
 * - weekly: weekly * 52 / 12
 * - daily: daily * operatingDays
 * - quarterly: quarterly / 3
 * - yearly: yearly / 12
 * - Excluded expenses return 0
 * - Asset depreciation / installment takes precedence if configured
 */
export function convertExpenseToMonthly(
  expense: {
    amount: number;
    frequency?: ExpenseFrequency;
    operatingDaysPerMonth?: number;
    isExcluded?: boolean;
    isInstallment?: boolean;
    monthlyInstallment?: number;
    assetCost?: number;
    usefulLifeYears?: number;
  },
  defaultOperatingDays: number = 30
): number {
  if (expense.isExcluded) {
    return 0;
  }

  // Check for asset installment vs depreciation
  if (
    expense.isInstallment ||
    (expense.monthlyInstallment && expense.monthlyInstallment > 0) ||
    (expense.assetCost && expense.assetCost > 0 && expense.usefulLifeYears && expense.usefulLifeYears > 0)
  ) {
    return calculateAssetMonthlyExpense(expense);
  }

  const baseAmount = Number(expense.amount) || 0;
  const frequency = expense.frequency || 'monthly';
  const opDays = expense.operatingDaysPerMonth && expense.operatingDaysPerMonth > 0
    ? expense.operatingDaysPerMonth
    : defaultOperatingDays;

  switch (frequency) {
    case 'weekly':
      return (baseAmount * 52) / 12;
    case 'daily':
      return baseAmount * opDays;
    case 'quarterly':
      return baseAmount / 3;
    case 'yearly':
      return baseAmount / 12;
    case 'monthly':
    default:
      return baseAmount;
  }
}

/**
 * 15.3 Calculate Total Monthly Expenses (Fixed vs Variable)
 * Automatically ignores expenses flagged as excluded
 */
export function calculateTotalMonthlyExpenses(
  expenses: ExpenseRecord[],
  defaultOperatingDays: number = 30
): {
  totalMonthly: number;
  fixedMonthly: number;
  variableMonthly: number;
  excludedMonthly: number;
} {
  let fixedMonthly = 0;
  let variableMonthly = 0;
  let excludedMonthly = 0;

  for (const exp of expenses) {
    if (exp.isExcluded) {
      // Calculate what it would be for auditing/reporting
      const unexcluded = convertExpenseToMonthly({ ...exp, isExcluded: false }, defaultOperatingDays);
      excludedMonthly += unexcluded;
      continue;
    }

    const monthlyAmount = convertExpenseToMonthly(exp, defaultOperatingDays);
    if (exp.isFixed) {
      fixedMonthly += monthlyAmount;
    } else {
      variableMonthly += monthlyAmount;
    }
  }

  return {
    totalMonthly: fixedMonthly + variableMonthly,
    fixedMonthly,
    variableMonthly,
    excludedMonthly,
  };
}

/**
 * 15.4 Normalize Sales to Ex-VAT
 * If input is VAT-inclusive, divide by (1 + vatRate / 100)
 */
export function calculateNormalizedNetSales(
  grossSales: number,
  discounts: number = 0,
  refunds: number = 0,
  isVatInclusive: boolean = false,
  vatRatePercent: number = 7
): number {
  const gross = Math.max(0, Number(grossSales) || 0);
  const disc = Math.max(0, Number(discounts) || 0);
  const ref = Math.max(0, Number(refunds) || 0);
  const nominalNet = Math.max(0, gross - disc - ref);

  if (isVatInclusive) {
    const vatFactor = 1 + (Math.max(0, vatRatePercent) / 100);
    return nominalNet / vatFactor;
  }
  return nominalNet;
}

/**
 * 15.5 Calculate Overhead % of Selling Price
 * Formula: (Total monthly fixed costs ÷ monthly net sales ex-VAT × 100) + sum of variable costs expressed as % of sales
 */
export function calculateOverheadRatePercent(
  monthlyFixedCosts: number,
  monthlyNetSalesExVat: number,
  variablePercentOfSales: number = 0
): number {
  if (monthlyNetSalesExVat <= 0) {
    return Math.max(0, variablePercentOfSales);
  }
  const fixedRatio = (monthlyFixedCosts / monthlyNetSalesExVat) * 100;
  return fixedRatio + Math.max(0, variablePercentOfSales);
}

/**
 * 15.6 Calculate Overhead Cost Per Dish
 * Overhead per plate = net selling price (ex-VAT) × overhead %
 */
export function calculateOverheadCostPerDish(
  sellingPriceExVat: number,
  overheadRatePercent: number
): number {
  if (sellingPriceExVat <= 0 || overheadRatePercent <= 0) return 0;
  return sellingPriceExVat * (overheadRatePercent / 100);
}

export interface BreakEvenAnalysisResult {
  isValid: boolean;
  errorMessageTh?: string;
  breakEvenSales: number;
  breakEvenDailySales: number;
  breakEvenOrders: number;
  breakEvenDailyOrders: number;
  safetyMarginRevenue: number;
  safetyMarginPercent: number;
  isProfitable: boolean;
  // Target profit extension
  targetProfitSales: number;
  targetProfitDailySales: number;
  targetProfitOrders: number;
  targetProfitDailyOrders: number;
  targetProfitValid: boolean;
  targetProfitErrorMessageTh?: string;
}

/**
 * 16. Calculate Detailed Break-Even & Target Profit Analysis
 * Tax basis: expects **ex-VAT** `actualNetSales` and **ex-VAT** `averageSellingPrice` (ticket);
 * returns **ex-VAT** monthly/daily break-even and target-profit sales figures.
 * Standard definitions:
 * - Break-even monthly sales = fixed costs ÷ (1 − food cost % − variable %)
 * - Target-profit sales = fixed costs ÷ (1 − food cost % − variable % − target profit %)
 * - If denominator ≤ 0: returns `isValid: false` with Thai message (never negative or Infinity).
 */
export function calculateDetailedBreakEven(
  fixedCosts: number,
  contributionMarginPercent: number, // (1 - food cost % - variable %) * 100
  averageSellingPrice: number = 100,
  operatingDaysPerMonth: number = 30,
  targetProfitPercent: number = 0,
  actualNetSales: number = 0
): BreakEvenAnalysisResult {
  const opDays = operatingDaysPerMonth > 0 ? operatingDaysPerMonth : 30;
  const ticket = averageSellingPrice > 0 ? averageSellingPrice : 100;

  // Validate denominator for break-even
  if (contributionMarginPercent <= 0) {
    return {
      isValid: false,
      errorMessageTh: 'ไม่สามารถคุ้มทุนได้เนื่องจากต้นทุนผันแปรรวมเกินหรือเท่ากับ 100% ของราคาขาย',
      breakEvenSales: 0,
      breakEvenDailySales: 0,
      breakEvenOrders: 0,
      breakEvenDailyOrders: 0,
      safetyMarginRevenue: 0,
      safetyMarginPercent: 0,
      isProfitable: false,
      targetProfitSales: 0,
      targetProfitDailySales: 0,
      targetProfitOrders: 0,
      targetProfitDailyOrders: 0,
      targetProfitValid: false,
      targetProfitErrorMessageTh: 'ไม่สามารถทำกำไรตามเป้าหมายได้เนื่องจากต้นทุนผันแปรรวมเกินหรือเท่ากับ 100% ของราคาขาย',
    };
  }

  if (fixedCosts < 0) {
    return {
      isValid: false,
      errorMessageTh: 'ต้นทุนคงที่ไม่ถูกต้อง (ต้องไม่ติดลบ)',
      breakEvenSales: 0,
      breakEvenDailySales: 0,
      breakEvenOrders: 0,
      breakEvenDailyOrders: 0,
      safetyMarginRevenue: 0,
      safetyMarginPercent: 0,
      isProfitable: false,
      targetProfitSales: 0,
      targetProfitDailySales: 0,
      targetProfitOrders: 0,
      targetProfitDailyOrders: 0,
      targetProfitValid: false,
    };
  }

  const cmRatio = contributionMarginPercent / 100;
  const breakEvenSales = fixedCosts / cmRatio;
  const breakEvenDailySales = breakEvenSales / opDays;
  const breakEvenOrders = ticket > 0 ? Math.ceil(breakEvenSales / ticket) : 0;
  const breakEvenDailyOrders = opDays > 0 ? Math.ceil(breakEvenOrders / opDays) : 0;

  const safetyMarginRevenue = actualNetSales > 0 ? actualNetSales - breakEvenSales : 0;
  const safetyMarginPercent = actualNetSales > 0 ? (safetyMarginRevenue / actualNetSales) * 100 : 0;
  const isProfitable = actualNetSales > 0 && actualNetSales >= breakEvenSales;

  // Target profit calculation
  let targetProfitSales = 0;
  let targetProfitDailySales = 0;
  let targetProfitOrders = 0;
  let targetProfitDailyOrders = 0;
  let targetProfitValid = true;
  let targetProfitErrorMessageTh: string | undefined = undefined;

  if (targetProfitPercent > 0) {
    const tpDenominator = (contributionMarginPercent - targetProfitPercent) / 100;
    if (tpDenominator <= 0) {
      targetProfitValid = false;
      targetProfitErrorMessageTh = 'ไม่สามารถทำกำไรตามเป้าหมายได้เนื่องจากต้นทุนผันแปรรวมและเป้าหมายกำไรเกินหรือเท่ากับ 100% ของราคาขาย';
      targetProfitSales = 0;
    } else {
      targetProfitSales = fixedCosts / tpDenominator;
      targetProfitDailySales = targetProfitSales / opDays;
      targetProfitOrders = ticket > 0 ? Math.ceil(targetProfitSales / ticket) : 0;
      targetProfitDailyOrders = opDays > 0 ? Math.ceil(targetProfitOrders / opDays) : 0;
    }
  }

  return {
    isValid: true,
    breakEvenSales,
    breakEvenDailySales,
    breakEvenOrders,
    breakEvenDailyOrders,
    safetyMarginRevenue,
    safetyMarginPercent,
    isProfitable,
    targetProfitSales,
    targetProfitDailySales,
    targetProfitOrders,
    targetProfitDailyOrders,
    targetProfitValid,
    targetProfitErrorMessageTh,
  };
}

/**
 * 17. Menu Engineering Matrix (Kasavana & Smith Matrix)
 * Classifies items into STAR, PLOWHORSE, PUZZLE, DOG based on:
 * - Sales Volume: High if >= Popularity Threshold = 70% × (1 / N) × Σ(salesVolume)
 * - Contribution Margin (CM): High if >= Weighted Average CM = Σ(CM × salesVolume) / Σ(salesVolume)
 * - Item CM (ex-VAT) = sellingPriceExVat - foodCost - packagingCost - platformFeePerItem
 */
export type MenuEngineeringCategory = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';

export interface MenuEngineeringInput {
  id: string;
  name: string;
  salesVolume: number;
  /** Menu selling price (ex-VAT by default; extracted when `isVatInclusive` is true). */
  sellingPrice: number;
  /** Optional explicit food cost (defaults to `totalDirectCost` when omitted). */
  foodCost?: number;
  /** Direct cost baseline (food cost, or food+pkg if `packagingCost` is omitted). */
  totalDirectCost: number;
  /** Packaging cost per item (if not already embedded in `totalDirectCost`). */
  packagingCost?: number;
  /** Delivery platform commission/GP fee per item (if sold on delivery). */
  platformFeePerItem?: number;
  /** Set true if `sellingPrice` includes VAT (and optional included service charge). */
  isVatInclusive?: boolean;
  vatRatePercent?: number;
  serviceChargeIncludedInPrice?: boolean;
  serviceChargePercent?: number;
  /** Optional explicit ex-VAT contribution margin override. */
  contributionMargin?: number;
}

export interface MenuEngineeringItem {
  id: string;
  name: string;
  salesVolume: number;
  sellingPrice: number;
  sellingPriceExVat: number;
  totalDirectCost: number;
  contributionMargin: number; // sellingPriceExVat - foodCost - packagingCost - platformFeePerItem
  category: MenuEngineeringCategory;
  recommendationTh: string;
  recommendationEn: string;
  actionTh: string;
}

export function calculateMenuEngineering(
  items: MenuEngineeringInput[]
): {
  classifiedItems: MenuEngineeringItem[];
  averageVolume: number;
  popularityThreshold: number;
  averageMargin: number;
  weightedAverageMargin: number;
  totalVolume: number;
  totalProfit: number;
} {
  if (!items || items.length === 0) {
    return {
      classifiedItems: [],
      averageVolume: 0,
      popularityThreshold: 0,
      averageMargin: 0,
      weightedAverageMargin: 0,
      totalVolume: 0,
      totalProfit: 0,
    };
  }

  const totalVolume = items.reduce((sum, item) => sum + Math.max(0, item.salesVolume || 0), 0);
  const averageVolume = totalVolume / items.length;
  // Kasavana & Smith 70% popularity rule: 0.70 × (1 / N) × Σ(salesVolume)
  const popularityThreshold = 0.7 * (1 / items.length) * totalVolume;

  const computedItems = items.map((item) => {
    const qty = Math.max(0, item.salesVolume || 0);
    const vatRate =
      typeof item.vatRatePercent === 'number' && Number.isFinite(item.vatRatePercent)
        ? Math.max(0, item.vatRatePercent)
        : 7;
    const scRate = item.serviceChargeIncludedInPrice
      ? Math.max(0, item.serviceChargePercent ?? 0) / 100
      : 0;
    const vatFactor = item.isVatInclusive ? (1 + scRate) * (1 + vatRate / 100) : 1;
    const sellingPriceExVat = vatFactor > 0 ? item.sellingPrice / vatFactor : item.sellingPrice;

    const foodCost =
      typeof item.foodCost === 'number' && Number.isFinite(item.foodCost)
        ? item.foodCost
        : item.totalDirectCost;
    const packagingCost =
      typeof item.packagingCost === 'number' && Number.isFinite(item.packagingCost)
        ? Math.max(0, item.packagingCost)
        : 0;
    const platformFeePerItem =
      typeof item.platformFeePerItem === 'number' && Number.isFinite(item.platformFeePerItem)
        ? Math.max(0, item.platformFeePerItem)
        : 0;

    const margin =
      typeof item.contributionMargin === 'number' && Number.isFinite(item.contributionMargin)
        ? item.contributionMargin
        : sellingPriceExVat - foodCost - packagingCost - platformFeePerItem;

    return {
      item,
      qty,
      sellingPriceExVat,
      margin,
    };
  });

  const totalProfit = computedItems.reduce((sum, entry) => sum + entry.margin * entry.qty, 0);
  // Kasavana & Smith sales-weighted average contribution margin: Σ(CM × qty) / Σ(qty)
  const weightedAverageMargin = totalVolume > 0 ? totalProfit / totalVolume : 0;
  const averageMargin = weightedAverageMargin;

  const classifiedItems: MenuEngineeringItem[] = computedItems.map(
    ({ item, qty, sellingPriceExVat, margin }) => {
      const isHighVolume = qty >= popularityThreshold;
      const isHighMargin = margin >= weightedAverageMargin;

      let category: MenuEngineeringCategory = 'DOG';
      let recommendationTh = '';
      let recommendationEn = '';
      let actionTh = '';

      if (isHighVolume && isHighMargin) {
        category = 'STAR';
        recommendationTh = 'เมนูทำเงินยอดนิยม รักษามาตรฐานและคุณภาพ ไม่ควรเปลี่ยนสูตรเด็ดขาด วางในจุดเด่นของเมนู';
        recommendationEn = 'High popularity & high profit. Maintain quality and promote visibility.';
        actionTh = 'รักษาคุณภาพ & โปรโมทต่อเนื่อง';
      } else if (isHighVolume && !isHighMargin) {
        category = 'PLOWHORSE';
        recommendationTh = 'ขายดีมากแต่กำไรบาง ควรปรับขึ้นราคาเล็กน้อย หรือปรับสัดส่วนวัตถุดิบต้นทุนสูงลง 5-10%';
        recommendationEn = 'High popularity but low margin. Reprice slightly or optimize portion/recipe cost.';
        actionTh = 'ปรับลดต้นทุน หรือ ปรับขึ้นราคา';
      } else if (!isHighVolume && isHighMargin) {
        category = 'PUZZLE';
        recommendationTh = 'กำไรต่อจานสูงแต่ยอดขายต่ำ ควรทำโปรโมชั่น แนะนำโดยพนักงาน หรือปรับภาพถ่ายให้ดึงดูด';
        recommendationEn = 'High profit but low sales. Promote actively, improve photos, or train staff to upsell.';
        actionTh = 'จัดโปรโมชั่น & แนะนำลูกค้า';
      } else {
        category = 'DOG';
        recommendationTh = 'ขายได้น้อยและกำไรต่ำ พิจารณาตัดออกจากเมนูเพื่อลดสต็อกของสด หรือปรับสูตรและราคาใหม่';
        recommendationEn = 'Low popularity & low margin. Consider removing from menu or reinventing.';
        actionTh = 'พิจารณาตัดทิ้ง หรือ รีแบรนด์สูตร';
      }

      return {
        id: item.id,
        name: item.name,
        salesVolume: qty,
        sellingPrice: item.sellingPrice,
        sellingPriceExVat,
        totalDirectCost: item.totalDirectCost,
        contributionMargin: margin,
        category,
        recommendationTh,
        recommendationEn,
        actionTh,
      };
    }
  );

  return {
    classifiedItems,
    averageVolume,
    popularityThreshold,
    averageMargin,
    weightedAverageMargin,
    totalVolume,
    totalProfit,
  };
}

/**
 * 19. Calculate Variance between Actual and Theoretical COGS
 * - varianceAmount = actualCOGS - theoreticalCOGS
 * - variancePercent = (varianceAmount / theoreticalCOGS) * 100
 * - threshold check: |varianceAmount| / netSales * 100 > thresholdPercent (default 3%)
 */
export function calculateVariance(
  actualCOGS: number,
  theoreticalCOGS: number,
  netSales?: number,
  thresholdPercent: number = 3.0
): {
  varianceAmount: number;
  variancePercent: number;
  variancePercentOfSales: number;
  thresholdPercent: number;
  varianceStatus: 'OVER_BUDGET' | 'ON_TRACK' | 'SAVINGS';
} {
  const round2 = (v: number) => (Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0);
  const varianceAmountRaw = actualCOGS - theoreticalCOGS;
  const variancePercentRaw = theoreticalCOGS > 0 ? (varianceAmountRaw / theoreticalCOGS) * 100 : 0;
  const hasNetSales = typeof netSales === 'number' && Number.isFinite(netSales) && netSales > 0;
  const variancePercentOfSalesRaw = hasNetSales
    ? (Math.abs(varianceAmountRaw) / netSales!) * 100
    : Math.abs(variancePercentRaw);
  const effectiveThreshold =
    typeof thresholdPercent === 'number' && Number.isFinite(thresholdPercent) && thresholdPercent >= 0
      ? thresholdPercent
      : 3.0;

  let varianceStatus: 'OVER_BUDGET' | 'ON_TRACK' | 'SAVINGS' = 'ON_TRACK';
  if (variancePercentOfSalesRaw > effectiveThreshold) {
    varianceStatus = varianceAmountRaw > 0 ? 'OVER_BUDGET' : 'SAVINGS';
  }

  return {
    varianceAmount: round2(varianceAmountRaw),
    variancePercent: round2(variancePercentRaw),
    variancePercentOfSales: round2(variancePercentOfSalesRaw),
    thresholdPercent: effectiveThreshold,
    varianceStatus,
  };
}

/**
 * 20. Calculate Target Price from Direct Cost
 */
export function calculateTargetPriceFromCost(
  directCost: number,
  targetFoodCostPercent: number = 30
): number {
  if (directCost <= 0 || targetFoodCostPercent <= 0) return 0;
  return Math.ceil(directCost / (targetFoodCostPercent / 100));
}

/**
 * 21. Calculate Delivery Gross Price to achieve same net revenue after GP and VAT
 */
export function calculateDeliveryGrossPrice(
  dineInPrice: number,
  gpPercent: number = 30,
  vatOnGpPercent: number = 7
): number {
  if (dineInPrice <= 0) return 0;
  const effectiveDeductionRatio = (gpPercent / 100) * (1 + vatOnGpPercent / 100);
  const payoutRatio = 1 - effectiveDeductionRatio;
  return payoutRatio > 0 ? Math.ceil(dineInPrice / payoutRatio) : Math.ceil(dineInPrice * 1.45);
}

/**
 * 22. Calculate Sub-recipe Batch Cost Alias
 */
export const calculateSubRecipeBatchCost = calculateSubRecipeBatch;

/**
 * 23. Calculate Channel Net Revenue
 */
export function calculateChannelNetRevenue(
  orderAmount: number,
  commissionPercent: number = 30,
  taxOnCommissionPercent: number = 7,
  paymentFeePercent: number = 0,
  fixedFeePerOrder: number = 0
): {
  orderAmount: number;
  commissionAmount: number;
  paymentFeeAmount: number;
  fixedFee: number;
  netPayout: number;
  effectiveDeductionPercent: number;
} {
  const commission = orderAmount * (commissionPercent / 100);
  const commissionTax = commission * (taxOnCommissionPercent / 100);
  const totalCommissionWithTax = commission + commissionTax;
  const paymentFee = orderAmount * (paymentFeePercent / 100);
  const fixedFee = fixedFeePerOrder;

  const totalDeductions = totalCommissionWithTax + paymentFee + fixedFee;
  const netPayout = Math.max(0, orderAmount - totalDeductions);
  const effectiveDeductionPercent = orderAmount > 0 ? (totalDeductions / orderAmount) * 100 : 0;

  return {
    orderAmount,
    commissionAmount: totalCommissionWithTax,
    paymentFeeAmount: paymentFee,
    fixedFee,
    netPayout,
    effectiveDeductionPercent,
  };
}

/**
 * 24. Calculate Scenario Impact
 */
export function calculateScenarioImpact(
  currentPrice: number,
  increasePercent: number,
  monthlyUsageQty: number,
  baseMonthlyNetProfit: number = 60000
): {
  newCostPerUnit: number;
  costIncreasePerUnit: number;
  totalMonthlyCostIncrease: number;
  newMonthlyNetProfit: number;
  profitErosionPercent: number;
} {
  const costIncreasePerUnit = currentPrice * (increasePercent / 100);
  const newCostPerUnit = currentPrice + costIncreasePerUnit;
  const totalMonthlyCostIncrease = costIncreasePerUnit * monthlyUsageQty;
  const newMonthlyNetProfit = Math.max(0, baseMonthlyNetProfit - totalMonthlyCostIncrease);
  const profitErosionPercent = baseMonthlyNetProfit > 0 ? (totalMonthlyCostIncrease / baseMonthlyNetProfit) * 100 : 0;

  return {
    newCostPerUnit,
    costIncreasePerUnit,
    totalMonthlyCostIncrease,
    newMonthlyNetProfit,
    profitErosionPercent,
  };
}

export function calculateIngredientPriceImpact(
  ingredientId: string,
  currentPrice: number,
  newPrice: number,
  affectedMenuItems: {
    menuId: string;
    menuName: string;
    currentSellingPrice: number;
    currentFoodCost: number;
    ingredientQuantityUsedInRecipe: number; // in purchase unit
    monthlyVolume: number;
  }[]
): {
  priceChangePercent: number;
  costDeltaPerPurchaseUnit: number;
  totalMonthlyImpactThb: number;
  menuImpacts: {
    menuId: string;
    menuName: string;
    currentSellingPrice: number;
    oldFoodCost: number;
    newFoodCost: number;
    foodCostDiff: number;
    oldFoodCostPercent: number;
    newFoodCostPercent: number;
    suggestedNewPriceToMaintainMargin: number;
    monthlyProfitChange: number;
  }[];
} {
  const priceChangePercent = currentPrice > 0 ? ((newPrice - currentPrice) / currentPrice) * 100 : 0;
  const costDeltaPerPurchaseUnit = newPrice - currentPrice;

  let totalMonthlyImpactThb = 0;

  const menuImpacts = affectedMenuItems.map((menu) => {
    const costAddition = costDeltaPerPurchaseUnit * menu.ingredientQuantityUsedInRecipe;
    const oldFoodCost = menu.currentFoodCost;
    const newFoodCost = oldFoodCost + costAddition;

    const oldFoodCostPercent = menu.currentSellingPrice > 0 ? (oldFoodCost / menu.currentSellingPrice) * 100 : 0;
    const newFoodCostPercent = menu.currentSellingPrice > 0 ? (newFoodCost / menu.currentSellingPrice) * 100 : 0;

    // To maintain old food cost %
    const targetRatio = oldFoodCostPercent > 0 ? oldFoodCostPercent / 100 : 0.30;
    const suggestedNewPriceToMaintainMargin = targetRatio > 0 ? Math.ceil(newFoodCost / targetRatio) : menu.currentSellingPrice;

    const monthlyProfitChange = -(costAddition * (menu.monthlyVolume || 0));
    totalMonthlyImpactThb += costAddition * (menu.monthlyVolume || 0);

    return {
      menuId: menu.menuId,
      menuName: menu.menuName,
      currentSellingPrice: menu.currentSellingPrice,
      oldFoodCost,
      newFoodCost,
      foodCostDiff: costAddition,
      oldFoodCostPercent,
      newFoodCostPercent,
      suggestedNewPriceToMaintainMargin,
      monthlyProfitChange,
    };
  });

  return {
    priceChangePercent,
    costDeltaPerPurchaseUnit,
    totalMonthlyImpactThb,
    menuImpacts,
  };
}

/**
 * 25. Calculate Food Cost & Profitability Metrics (F7, F9, F13, C-02)
 * If price includes VAT, net price = price / 1.07 before computing Food Cost %, overhead, and profit.
 * If price is 0, Food Cost % and profit % return null / '-' (no NaN / Infinity).
 */
export interface FoodCostMetricsResult {
  ingredientCost: number;
  extraCosts: number;
  sellingPrice: number;
  netSellingPrice: number;
  vatAmount: number;
  overheadPercent: number;
  overheadCost: number;
  totalCost: number;
  foodCostPercent: number | null;
  totalCostPercent: number | null;
  profit: number;
  profitAmount: number;
  profitPercent: number | null;
  foodCostPercentDisplay: string;
  profitPercentDisplay: string;
}

export function calculateFoodCostMetrics(
  ingredientCost: number,
  extraCosts: number = 0,
  sellingPrice: number = 0,
  overheadPercent: number = 0,
  isVatInclusive: boolean = false,
  vatRatePercent: number = 7
): FoodCostMetricsResult {
  const netSellingPrice = isVatInclusive && vatRatePercent > 0
    ? Number((sellingPrice / (1 + vatRatePercent / 100)).toFixed(2))
    : sellingPrice;
  const vatAmount = isVatInclusive ? Number((sellingPrice - netSellingPrice).toFixed(2)) : 0;
  const overheadCost = Number((netSellingPrice * (overheadPercent / 100)).toFixed(2));
  const totalCost = Number((ingredientCost + extraCosts + overheadCost).toFixed(2));
  const profit = Number((netSellingPrice - totalCost).toFixed(2));

  if (netSellingPrice <= 0) {
    return {
      ingredientCost,
      extraCosts,
      sellingPrice,
      netSellingPrice,
      vatAmount,
      overheadPercent,
      overheadCost,
      totalCost,
      foodCostPercent: null,
      totalCostPercent: null,
      profit,
      profitAmount: profit,
      profitPercent: null,
      foodCostPercentDisplay: '-',
      profitPercentDisplay: '-',
    };
  }

  const foodCostPercent = Number(((ingredientCost / netSellingPrice) * 100).toFixed(1));
  const totalCostPercent = Number(((totalCost / netSellingPrice) * 100).toFixed(1));
  const profitPercent = Number(((profit / netSellingPrice) * 100).toFixed(1));

  return {
    ingredientCost,
    extraCosts,
    sellingPrice,
    netSellingPrice,
    vatAmount,
    overheadPercent,
    overheadCost,
    totalCost,
    foodCostPercent,
    totalCostPercent,
    profit,
    profitAmount: profit,
    profitPercent,
    foodCostPercentDisplay: foodCostPercent.toFixed(1),
    profitPercentDisplay: profitPercent.toFixed(1),
  };
}

/**
 * 26. Calculate Rounded Ex-VAT Suggested Selling Price (F8, F14, H-02)
 * Tax basis: computes **ex-VAT** suggested selling price from `cost / (targetFoodCostPercent / 100)`,
 * always rounded UP to the chosen 1 / 5 / 10 THB step.
 */
export function calculateRoundedExVatSuggestedPrice(
  cost: number,
  targetFoodCostPercent: number,
  roundingStep: 1 | 5 | 10 = 1
): {
  rawPrice: number;
  roundedPrice: number;
  roundedStep1: number;
  roundedStep5: number;
  roundedStep10: number;
} {
  if (cost <= 0 || targetFoodCostPercent <= 0) {
    return { rawPrice: 0, roundedPrice: 0, roundedStep1: 0, roundedStep5: 0, roundedStep10: 0 };
  }
  const rawFloat = cost / (targetFoodCostPercent / 100);
  const rawPrice = Number(rawFloat.toFixed(2));
  const roundedStep1 = Math.ceil(rawFloat / 1) * 1;
  const roundedStep5 = Math.ceil(rawFloat / 5) * 5;
  const roundedStep10 = Math.ceil(rawFloat / 10) * 10;
  const roundedPrice = Math.ceil(rawFloat / roundingStep) * roundingStep;
  return { rawPrice, roundedPrice, roundedStep1, roundedStep5, roundedStep10 };
}

/**
 * 27. Delivery Suggested Price & Commission with VAT Toggle (F11, C-01)
 * Effective GP = GP% * 1.07 when GP has VAT.
 */
export function calculateDeliveryPricing(
  cost: number,
  targetFoodCostPercent: number,
  gpPercent: number = 30,
  gpHasVat: boolean = true,
  vatRatePercent: number = 7
): {
  baseTargetPrice: number;
  effectiveGpPercent: number;
  deliverySuggestedPrice: number;
  suggestedDeliveryPrice: number;
} {
  const baseTargetPrice = targetFoodCostPercent > 0 ? cost / (targetFoodCostPercent / 100) : cost;
  const effectiveGpPercent = gpHasVat ? Number((gpPercent * (1 + vatRatePercent / 100)).toFixed(1)) : gpPercent;
  const gpRatio = effectiveGpPercent / 100;
  const deliverySuggestedPrice = gpRatio < 1 ? Number((baseTargetPrice / (1 - gpRatio)).toFixed(2)) : baseTargetPrice;

  return {
    baseTargetPrice,
    effectiveGpPercent,
    deliverySuggestedPrice,
    suggestedDeliveryPrice: deliverySuggestedPrice,
  };
}

/**
 * 28. Delivery Profitability & Net Revenue (F12, C-01)
 */
export function calculateDeliveryProfitability(
  deliveryPrice: number,
  cost: number,
  packagingCost: number = 0,
  gpPercent: number = 30,
  gpHasVat: boolean = true,
  vatRatePercent: number = 7
): {
  gpFee: number;
  netRevenue: number;
  foodCostPercent: number;
  profitBeforeOverhead: number;
} {
  const effectiveGp = gpHasVat ? gpPercent * (1 + vatRatePercent / 100) : gpPercent;
  const gpFee = Number((deliveryPrice * (effectiveGp / 100)).toFixed(2));
  const netRevenue = Number((deliveryPrice - gpFee).toFixed(2));
  const foodCostPercent = netRevenue > 0 ? Number(((cost / netRevenue) * 100).toFixed(1)) : 0;
  const profitBeforeOverhead = Number((netRevenue - cost - packagingCost).toFixed(2));

  return {
    gpFee,
    netRevenue,
    foodCostPercent,
    profitBeforeOverhead,
  };
}

/**
 * 29. Calculate Customer Bill with Service Charge & VAT (F9, F10)
 * Supports both VAT-exclusive and VAT-inclusive menu pricing, including optional Service Charge.
 */
export function calculateBillTotal(
  basePrice: number,
  serviceChargePercent: number = 0,
  vatRatePercent: number = 7,
  isVatInclusive: boolean = false,
  serviceChargeIncludedInPrice: boolean = false
): {
  basePrice: number;
  basePriceExVat: number;
  serviceChargeAmount: number;
  vatAmount: number;
  totalCustomerPays: number;
  customerPay: number;
} {
  const scRate = Math.max(0, serviceChargePercent || 0) / 100;
  const vatRate = Math.max(0, vatRatePercent || 0) / 100;

  if (isVatInclusive) {
    if (serviceChargeIncludedInPrice) {
      const factor = (1 + scRate) * (1 + vatRate);
      const netSales = factor > 0 ? basePrice / factor : basePrice;
      const basePriceExVat = Number(netSales.toFixed(2));
      const serviceChargeAmount = Number((netSales * scRate).toFixed(2));
      const vatAmount = Number(((netSales + serviceChargeAmount) * vatRate).toFixed(2));
      return {
        basePrice,
        basePriceExVat,
        serviceChargeAmount,
        vatAmount,
        totalCustomerPays: basePrice,
        customerPay: basePrice,
      };
    }

    const netFood = vatRate > -1 ? basePrice / (1 + vatRate) : basePrice;
    const basePriceExVat = Number(netFood.toFixed(2));
    const vatFood = basePrice - netFood;
    const rawServiceCharge = netFood * scRate;
    const rawVatOnSc = rawServiceCharge * vatRate;
    const serviceChargeAmount = Number(rawServiceCharge.toFixed(2));
    const vatAmount = Number((vatFood + rawVatOnSc).toFixed(2));
    const totalCustomerPays = Number((basePrice + rawServiceCharge + rawVatOnSc).toFixed(2));
    return {
      basePrice,
      basePriceExVat,
      serviceChargeAmount,
      vatAmount,
      totalCustomerPays,
      customerPay: totalCustomerPays,
    };
  }

  const rawServiceCharge = basePrice * scRate;
  const subtotalWithService = basePrice + rawServiceCharge;
  const rawVat = subtotalWithService * vatRate;
  const serviceChargeAmount = Number(rawServiceCharge.toFixed(2));
  const vatAmount = Number(rawVat.toFixed(2));
  const totalCustomerPays = Number((subtotalWithService + rawVat).toFixed(2));

  return {
    basePrice,
    basePriceExVat: basePrice,
    serviceChargeAmount,
    vatAmount,
    totalCustomerPays,
    customerPay: totalCustomerPays,
  };
}

/**
 * 30. Calculate Sub-Recipe Cost (Pure F&B Standard) (F5, F6, F15, H-03)
 * Rule: Sub-recipe batch cost = total ingredient cost;
 * cost per unit = batch cost ÷ actual output quantity; NEVER multiply by 100/yield.
 */
export function calculateSubRecipeCostPure(
  batchIngredientsCost: number,
  finalOutputQuantity: number,
  _rawInputQuantity?: number
): {
  batchCost: number;
  costPerOutputUnit: number;
  costPerUnit: number;
} {
  const batchCost = batchIngredientsCost;
  const rawCostPerUnit = finalOutputQuantity > 0 ? batchCost / finalOutputQuantity : 0;
  const costPerOutputUnit = Number(rawCostPerUnit.toFixed(4));
  return {
    batchCost,
    costPerOutputUnit,
    costPerUnit: costPerOutputUnit,
  };
}

/**
 * 31. Calculate Ingredient Usage Cost in Recipe (F1, F2, F3, F4, F14, M-01)
 * Enforces unit compatibility; incompatible units return an error and cost 0.
 */
export function calculateIngredientItemCost(params: {
  purchasePrice: number;
  purchaseQuantity: number;
  purchaseUnit: string;
  usageQuantity: number;
  usageUnit: string;
  yieldPercent?: number; // Ingredient standard yield %
  ingredientYield?: number; // Alias for yieldPercent
  lineYieldOverride?: number; // Optional recipe line yield override %
  piecesPerPurchaseUnit?: number; // e.g. 30 eggs per pack, 24 cans per case
  piecesCountAlreadyYieldAdjusted?: boolean; // true if piece count already accounts for trim/shell loss
  density?: number;
}): {
  unitCost: number;
  lineCost: number;
  isValid: boolean;
  missingPrice?: boolean;
  errorMessageTh?: string;
} {
  const {
    purchasePrice,
    purchaseQuantity,
    purchaseUnit,
    usageQuantity,
    usageUnit,
    lineYieldOverride,
    piecesPerPurchaseUnit,
    piecesCountAlreadyYieldAdjusted,
    density,
  } = params;

  const missingPrice = !purchasePrice || purchasePrice <= 0 || isNaN(purchasePrice);
  if (missingPrice || purchaseQuantity <= 0 || usageQuantity < 0) {
    return {
      unitCost: 0,
      lineCost: 0,
      isValid: false,
      missingPrice,
      errorMessageTh: missingPrice
        ? 'ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง'
        : 'ข้อมูลราคาหรือปริมาณไม่ถูกต้อง',
    };
  }

  const rawYield = params.yieldPercent ?? params.ingredientYield ?? 100;
  // Effective yield %
  const effectiveYield = (lineYieldOverride && lineYieldOverride > 0)
    ? lineYieldOverride
    : (rawYield > 0 ? rawYield : 100);

  const normP = normalizeUnitToken(purchaseUnit);
  const normU = normalizeUnitToken(usageUnit);

  // Case A: Pieces / Pack / Egg count items (e.g. 2 trays * 30 eggs/tray = 60 eggs)
  if (piecesPerPurchaseUnit && piecesPerPurchaseUnit > 0 && isPieceLikeUnit(normU)) {
    const isSameOrUnspecifiedUnit = !normP || normP === normU || isPieceLikeUnit(normP);
    const totalPieces =
      isSameOrUnspecifiedUnit && purchaseQuantity === piecesPerPurchaseUnit
        ? piecesPerPurchaseUnit
        : purchaseQuantity * piecesPerPurchaseUnit;
    const effectivePieces = piecesCountAlreadyYieldAdjusted
      ? totalPieces
      : totalPieces * (effectiveYield / 100);
    if (effectivePieces <= 0) {
      return {
        unitCost: 0,
        lineCost: 0,
        isValid: false,
        missingPrice: false,
        errorMessageTh: 'จำนวนชิ้นสุทธิหลังหัก Yield ต้องมากกว่า 0',
      };
    }
    const costPerPiece = purchasePrice / effectivePieces;
    const cost = usageQuantity * costPerPiece;
    return {
      unitCost: costPerPiece,
      lineCost: cost,
      isValid: true,
      missingPrice: false,
    };
  }

  // Direct piece matching (only matching piece types or generic piece)
  if (isPieceLikeUnit(normP) && isPieceLikeUnit(normU) && (normP === normU || normP === 'piece' || normU === 'piece')) {
    const effectivePieces = piecesCountAlreadyYieldAdjusted
      ? purchaseQuantity
      : purchaseQuantity * (effectiveYield / 100);
    const costPerPiece = purchasePrice / effectivePieces;
    const cost = usageQuantity * costPerPiece;
    return {
      unitCost: costPerPiece,
      lineCost: cost,
      isValid: true,
      missingPrice: false,
    };
  }

  // Mass & Volume unit conversion
  const conv = convertUnit(usageQuantity, normU, normP, density);
  if (!conv.success) {
    const isDensityNeeded = (conv.errorMessageTh || '').includes('ต้องระบุความหนาแน่น');
    return {
      unitCost: 0,
      lineCost: 0,
      isValid: false,
      missingPrice: false,
      errorMessageTh: isDensityNeeded
        ? `ต้องระบุความหนาแน่นเพื่อแปลง ${purchaseUnit} เป็น ${usageUnit}`
        : conv.errorMessageTh || `หน่วยไม่ตรงกัน: "${usageUnit}" ไม่สามารถแปลงเป็น "${purchaseUnit}" ได้`,
    };
  }

  // Cost per usable purchase unit
  const costPerUsablePurchaseUnit = purchasePrice / (purchaseQuantity * (effectiveYield / 100));
  const exactLineCost = conv.convertedQuantity * costPerUsablePurchaseUnit;
  const lineCost = Number(exactLineCost.toFixed(2));
  const unitCost = usageQuantity > 0 ? exactLineCost / usageQuantity : 0;

  return {
    unitCost,
    lineCost,
    isValid: true,
    missingPrice: false,
  };
}

/**
 * 32. Calculate Logged Sales Average & Projection (O11, E2)
 * Averages over the last N logged days (N = 7/14/30).
 * Warns if fewer than 7 days logged.
 */
export function calculateLoggedSalesProjection(
  dailySalesRecords: Array<{ date: string; netSales: number }>,
  daysToAverage: number = 14,
  operatingDaysPerMonth: number = 30
): {
  uniqueLoggedDays: number;
  averageDailySales: number;
  projectedMonthlySales: number;
  isDataSufficient: boolean;
  warningMessageTh?: string;
} {
  const salesByDate = new Map<string, number>();
  for (const r of dailySalesRecords) {
    salesByDate.set(r.date, (salesByDate.get(r.date) || 0) + (r.netSales || 0));
  }
  const sortedDates = Array.from(salesByDate.keys()).sort().reverse();
  const selectedDates = sortedDates.slice(0, daysToAverage);
  const uniqueLoggedDays = selectedDates.length;

  if (uniqueLoggedDays === 0) {
    return {
      uniqueLoggedDays: 0,
      averageDailySales: 0,
      projectedMonthlySales: 0,
      isDataSufficient: false,
      warningMessageTh: 'ยังไม่มีข้อมูลยอดขายที่บันทึก',
    };
  }

  const totalSales = selectedDates.reduce((sum, d) => sum + (salesByDate.get(d) || 0), 0);
  const averageDailySales = totalSales / uniqueLoggedDays;
  const projectedMonthlySales = averageDailySales * operatingDaysPerMonth;
  const isDataSufficient = uniqueLoggedDays >= 7;

  return {
    uniqueLoggedDays,
    averageDailySales,
    projectedMonthlySales,
    isDataSufficient,
    warningMessageTh: !isDataSufficient ? 'ข้อมูลยอดขายบันทึกไว้น้อยเกินไป (ต้องการอย่างน้อย 7 วัน)' : undefined,
  };
}

/**
 * 33. Seated Capacity Overhead Calculation (O5)
 * seats × turns × spend × days = sales; warns if overhead > 50%.
 */
export function calculateSeatedOverhead(
  seats: number,
  turnsPerDay: number,
  averageSpend: number,
  daysPerMonth: number,
  fixedCosts: number
): {
  monthlyCapacitySales: number;
  overheadPercent: number;
  hasHighOverheadWarning: boolean;
  warningMessageTh?: string;
} {
  const monthlyCapacitySales = seats * turnsPerDay * averageSpend * daysPerMonth;
  const overheadPercent = monthlyCapacitySales > 0 ? (fixedCosts / monthlyCapacitySales) * 100 : 0;
  const hasHighOverheadWarning = overheadPercent > 50;

  return {
    monthlyCapacitySales,
    overheadPercent,
    hasHighOverheadWarning,
    warningMessageTh: hasHighOverheadWarning
      ? `คำเตือน: อัตราโสหุ้ยสูงเกิน 50% (${overheadPercent.toFixed(1)}%) ร้านมีความเสี่ยงสูงต่อผลขาดทุน`
      : undefined,
  };
}

/**
 * 34. Overhead Sensitivity Analysis (O10)
 */
export function calculateOverheadSensitivity(
  baseSalesExVat: number,
  fixedCosts: number,
  variablePercent: number = 0,
  percentages: number[] = [70, 100, 130, 150]
): Array<{
  multiplierPercent: number;
  salesVolume: number;
  overheadPercent: number;
}> {
  return percentages.map((pct) => {
    const salesVolume = baseSalesExVat * (pct / 100);
    const overheadPercent = salesVolume > 0 ? (fixedCosts / salesVolume) * 100 + variablePercent : 0;
    return {
      multiplierPercent: pct,
      salesVolume,
      overheadPercent,
    };
  });
}

/**
 * 35. Format Currency to Thai Baht with 2 Decimal Places (L-01)
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '-';
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 36. Circular Sub-recipe Reference Prevention (Integration Test)
 * Detects self-reference (A->A) and cyclic chains (A->B->A).
 */
export function checkCircularSubRecipe(
  targetSubRecipeId: string,
  newDependencyId: string,
  allSubRecipes: Array<{ id: string; items: Array<{ ingredientId: string }> }>
): boolean {
  if (targetSubRecipeId === newDependencyId) {
    return true;
  }
  const visited = new Set<string>();
  const queue = [newDependencyId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetSubRecipeId) {
      return true;
    }
    if (!visited.has(current)) {
      visited.add(current);
      const sub = allSubRecipes.find((s) => s.id === current);
      if (sub && sub.items) {
        for (const it of sub.items) {
          queue.push(it.ingredientId);
        }
      }
    }
  }
  return false;
}

/**
 * 37. Check Ingredient Usage in Menus & Sub-recipes (Integration Test)
 * Blocks deletion if ingredient is used in any menu or sub-recipe.
 */
export function checkIngredientUsage(
  ingredientId: string,
  menus: Array<{ name: string; variants?: Array<{ name?: string; recipeItems: Array<{ ingredientId: string }> }> }>,
  subRecipes: Array<{ name: string; items: Array<{ ingredientId: string }> }>
): { isUsed: boolean; usedInNames: string[] } {
  const usedInNames: string[] = [];
  for (const m of menus) {
    for (const v of m.variants || []) {
      if (v.recipeItems?.some((it) => it.ingredientId === ingredientId)) {
        usedInNames.push(`เมนู: ${m.name} (${v.name || ''})`);
      }
    }
  }
  for (const s of subRecipes) {
    if (s.items?.some((it) => it.ingredientId === ingredientId)) {
      usedInNames.push(`สูตรกลาง/ซอส: ${s.name}`);
    }
  }
  return {
    isUsed: usedInNames.length > 0,
    usedInNames,
  };
}

/**
 * Normalizes sales channel ID for upsert deduplication while keeping empty channelId isolated.
 * Empty string '' ONLY matches '', preventing cross-channel overwrites.
 */
export function normalizeUpsertChannelId(channelId: string | null | undefined): string {
  const raw = (channelId || '').trim().toLowerCase().replace(/-/g, '_');
  if (!raw) return '';
  if (raw === 'dinein') return 'dine_in';
  if (raw === 'take_away') return 'takeaway';
  if (raw === 'grabfood') return 'grab';
  if (raw === 'line_man') return 'lineman';
  return raw;
}

/**
 * 38. Upsert Daily Sales Record (O14, E1)
 * If exact same date AND channel already exist, update that channel row without affecting other channels.
 */
export function upsertDailySalesRecord<
  T extends {
    id: string;
    date: string;
    channelId?: string;
    netSales?: number;
    grossSales?: number;
    replacesPosSync?: boolean;
  }
>(records: T[], newRecord: T): T[] {
  const targetCh = normalizeUpsertChannelId(newRecord.channelId);
  const index = records.findIndex(
    (r) => r.date === newRecord.date && normalizeUpsertChannelId(r.channelId) === targetCh
  );
  if (index >= 0) {
    const updated = [...records];
    const existing = records[index];
    const replacingPosWithManual =
      existing.id?.startsWith('pos_sync_') && !newRecord.id?.startsWith('pos_sync_');
    const resolvedId = replacingPosWithManual ? newRecord.id : existing.id;
    updated[index] = {
      ...newRecord,
      id: resolvedId,
      ...(replacingPosWithManual ? { replacesPosSync: true } : {}),
    };
    return updated;
  }
  return [newRecord, ...records];
}

/**
 * Computes delivery/channel GP fee based on configured gpBase ('gross_incl_vat' vs 'net_ex_vat').
 */
export function calculateChannelPlatformFees(params: {
  grossSales: number;
  discounts: number;
  refunds: number;
  isVatInclusive: boolean;
  vatRatePercent: number;
  channel?: {
    commissionPercent?: number;
    taxOnCommissionPercent?: number;
    gpBase?: 'gross_incl_vat' | 'net_ex_vat';
  };
}): {
  netSalesExVat: number;
  gpFeeBase: number;
  commission: number;
  vatOnCommission: number;
  platformFees: number;
  actualPayout: number;
} {
  const nominalNet = Math.max(
    0,
    (params.grossSales || 0) - (params.discounts || 0) - (params.refunds || 0)
  );
  const netSalesExVat = calculateNormalizedNetSales(
    params.grossSales || 0,
    params.discounts || 0,
    params.refunds || 0,
    params.isVatInclusive,
    params.vatRatePercent
  );
  const gpBase = params.channel?.gpBase || 'gross_incl_vat';
  const gpFeeBase = gpBase === 'net_ex_vat' ? netSalesExVat : nominalNet;
  const commRate = Math.max(0, params.channel?.commissionPercent || 0) / 100;
  const taxOnCommRate = Math.max(0, params.channel?.taxOnCommissionPercent || 0) / 100;
  const commission = gpFeeBase * commRate;
  const vatOnCommission = commission * taxOnCommRate;
  const platformFees = commission + vatOnCommission;
  const actualPayout = Math.max(0, nominalNet - platformFees);

  return {
    netSalesExVat,
    gpFeeBase,
    commission,
    vatOnCommission,
    platformFees,
    actualPayout,
  };
}

/**
 * 39. Validate Expense and Overhead Input (O13, E4)
 * Rejects negative numbers, asset life years = 0, and percentage outside 0-100 with clear Thai messages.
 */
export function validateExpenseInput(input: {
  amount?: number;
  assetCost?: number;
  usefulLifeYears?: number;
  isAsset?: boolean;
  isInstallment?: boolean;
}): { isValid: boolean; errorMessageTh?: string } {
  if (input.amount !== undefined && input.amount < 0) {
    return { isValid: false, errorMessageTh: 'จำนวนเงินต้องไม่ติดลบ (ต้องมากกว่าหรือเท่ากับ 0)' };
  }
  if (input.isAsset && !input.isInstallment) {
    if (input.assetCost !== undefined && input.assetCost < 0) {
      return { isValid: false, errorMessageTh: 'มูลค่าสินทรัพย์ต้องไม่ติดลบ' };
    }
    if (input.usefulLifeYears !== undefined && input.usefulLifeYears <= 0) {
      return { isValid: false, errorMessageTh: 'อายุการใช้งานสินทรัพย์ต้องมากกว่า 0 ปี' };
    }
  }
  return { isValid: true };
}

export function validatePercentage(percent: number): { isValid: boolean; errorMessageTh?: string } {
  if (percent < 0 || percent > 100) {
    return { isValid: false, errorMessageTh: 'ค่าเปอร์เซ็นต์ต้องอยู่ระหว่าง 0 ถึง 100%' };
  }
  return { isValid: true };
}

