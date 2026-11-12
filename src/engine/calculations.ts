import {
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
  DishVariant,
  OptionChoice,
  OrderItem,
  ChannelDoc,
  EmployeeDoc,
} from '../types';

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
  // Default to piece
  return { baseUnit: 'piece', multiplier: 1 };
}

/**
 * Calculates the cost per base unit for an ingredient given its purchase parameters and yield.
 * Yield % represents usable percentage after trimming/cooking (e.g. 80% yield means 1kg raw = 800g usable).
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
 * Calculates the batch cost and per-output-unit cost of a sub-recipe.
 */
export function calculateSubRecipeCost(
  subRecipe: SubRecipeDoc,
  ingredientsMap: Map<string, IngredientDoc>,
  subRecipesMap: Map<string, SubRecipeDoc>,
  visited: Set<string> = new Set()
): { totalBatchCost: number; costPerOutputUnit: number; hasMissing: boolean } {
  if (visited.has(subRecipe.id)) {
    // Prevent circular recursion
    return { totalBatchCost: 0, costPerOutputUnit: 0, hasMissing: true };
  }
  visited.add(subRecipe.id);

  let totalBatchCost = 0;
  let hasMissing = false;

  // Ingredient costs
  if (Array.isArray(subRecipe.ingredients)) {
    for (const item of subRecipe.ingredients) {
      const ing = ingredientsMap.get(item.ingredientId);
      if (!ing || ing.costPerBaseUnit === undefined || ing.costPerBaseUnit <= 0) {
        hasMissing = true;
      } else {
        totalBatchCost += item.quantity * ing.costPerBaseUnit;
      }
    }
  }

  // Nested sub-recipes if any
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
 * Calculates the exact dynamic food cost for a dish variant.
 * Dishes never store calculated cost in the database; it is computed live.
 */
export function calculateDishVariantCost(
  variant: DishVariant,
  ingredientsMap: Map<string, IngredientDoc>,
  subRecipesMap: Map<string, SubRecipeDoc>,
  packagingMap: Map<string, PackagingDoc>
): {
  totalCost: number;
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
      if (!ing || ing.costPerBaseUnit === undefined || ing.costPerBaseUnit === null) {
        hasMissing = true;
      } else {
        ingredientsCost += line.quantity * ing.costPerBaseUnit;
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
      if (!pkg || pkg.cost === undefined || pkg.cost === null) {
        hasMissing = true;
      } else {
        packagingCost += line.quantity * pkg.cost;
      }
    }
  }

  const totalCost = ingredientsCost + subRecipesCost + packagingCost;

  return {
    totalCost,
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

  if (Array.isArray(choice.ingredients)) {
    for (const line of choice.ingredients) {
      const ing = ingredientsMap.get(line.ingredientId);
      if (!ing || ing.costPerBaseUnit === undefined || ing.costPerBaseUnit === null) {
        hasMissing = true;
      } else {
        cost += line.quantity * ing.costPerBaseUnit;
      }
    }
  }

  return { cost, hasMissing };
}

/**
 * Calculates suggested selling price based on target food cost %:
 * suggestedPrice = cost / (targetFoodCostPercent / 100)
 */
export function calculateSuggestedPrice(cost: number, targetFoodCostPercent: number): number {
  if (cost <= 0 || targetFoodCostPercent <= 0) return 0;
  return roundTo2(cost / (targetFoodCostPercent / 100));
}

/**
 * Calculates food cost %:
 * (cost / price) * 100
 */
export function calculateFoodCostPercent(cost: number, price: number): number {
  if (price <= 0 || cost <= 0) return 0;
  return (cost / price) * 100;
}

/**
 * Calculates full bill totals, taxes, service charges, net sales, and food cost snapshot.
 * Full precision is maintained internally and rounded to 2 decimals for grand total.
 */
export function calculateBillFinancials(
  items: OrderItem[],
  discountAmountInput: number,
  serviceChargePercent: number,
  vatPercent: number,
  channel?: ChannelDoc
): {
  subtotal: number;
  discountAmount: number;
  taxableSubtotal: number;
  serviceChargeAmount: number;
  vatAmount: number;
  grandTotal: number;
  netSales: number;
  totalFoodCost: number;
  packagingCost: number;
  platformFee: number;
  grossProfit: number;
  foodCostPercent: number;
} {
  let subtotal = 0;
  let totalFoodCost = 0;

  for (const item of items) {
    const qty = item.quantity || 1;
    subtotal += item.unitPrice * qty;
    totalFoodCost += item.totalUnitCostSnapshot * qty;
  }

  const discountAmount = Math.max(0, Math.min(discountAmountInput, subtotal));
  const taxableSubtotal = Math.max(0, subtotal - discountAmount);

  // Service charge
  const scRate = Math.max(0, serviceChargePercent || 0);
  const serviceChargeAmount = (taxableSubtotal * scRate) / 100;

  // VAT (applied on taxableSubtotal + serviceCharge)
  const vatRate = Math.max(0, vatPercent || 0);
  const baseForVat = taxableSubtotal + serviceChargeAmount;
  const vatAmount = (baseForVat * vatRate) / 100;

  // Grand Total rounded to 2 decimals
  const grandTotal = roundTo2(baseForVat + vatAmount);

  // Net sales represents revenue excluding VAT and service charge, after discounts
  const netSales = taxableSubtotal;

  // Channel delivery commission & packaging
  let platformFee = 0;
  let packagingCost = 0;
  if (channel) {
    if (channel.commissionPercent > 0) {
      platformFee = (netSales * channel.commissionPercent) / 100;
    }
    packagingCost = channel.packagingCost || 0;
  }

  const grossProfit = netSales - totalFoodCost - platformFee - packagingCost;
  const foodCostPercent = netSales > 0 ? (totalFoodCost / netSales) * 100 : 0;

  return {
    subtotal: roundTo2(subtotal),
    discountAmount: roundTo2(discountAmount),
    taxableSubtotal: roundTo2(taxableSubtotal),
    serviceChargeAmount: roundTo2(serviceChargeAmount),
    vatAmount: roundTo2(vatAmount),
    grandTotal,
    netSales: roundTo2(netSales),
    totalFoodCost: roundTo2(totalFoodCost),
    packagingCost: roundTo2(packagingCost),
    platformFee: roundTo2(platformFee),
    grossProfit: roundTo2(grossProfit),
    foodCostPercent: roundTo2(foodCostPercent),
  };
}

/**
 * Calculates the business work date (YYYY-MM-DD) taking dailyClosingTime into account.
 * For example: if dailyClosingTime is "04:00" and current time is 02:30 AM on Nov 12,
 * it belongs to the Nov 11 work date.
 */
export function getBusinessWorkDate(dateObj: Date = new Date(), dailyClosingTime: string = '04:00'): string {
  const [closingHoursStr, closingMinutesStr] = (dailyClosingTime || '04:00').split(':');
  const closingHour = parseInt(closingHoursStr, 10) || 0;
  const closingMinute = parseInt(closingMinutesStr, 10) || 0;

  const currentHour = dateObj.getHours();
  const currentMinute = dateObj.getMinutes();

  const adjustedDate = new Date(dateObj.getTime());

  // If before closing time, roll back 1 day
  if (currentHour < closingHour || (currentHour === closingHour && currentMinute < closingMinute)) {
    adjustedDate.setDate(adjustedDate.getDate() - 1);
  }

  const year = adjustedDate.getFullYear();
  const month = String(adjustedDate.getMonth() + 1).padStart(2, '0');
  const day = String(adjustedDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Calculates employee monthly cost equivalent.
 */
export function calculateEmployeeMonthlyCost(employee: EmployeeDoc): number {
  if (!employee.isActive) return 0;
  if (employee.wageType === 'monthly') {
    return employee.wageAmount;
  }
  if (employee.wageType === 'daily') {
    const days = employee.workDaysOrHoursPerMonth || 26;
    return employee.wageAmount * days;
  }
  if (employee.wageType === 'hourly') {
    const hours = employee.workDaysOrHoursPerMonth || 208; // 26 days * 8 hours
    return employee.wageAmount * hours;
  }
  return 0;
}

/**
 * Calculates break-even sales:
 * Break-even = Total Fixed Overhead / Contribution Margin %
 */
export function calculateBreakEven(
  monthlyFixedExpenses: number,
  monthlyLaborCost: number,
  contributionMarginPercent: number
): {
  totalFixedOverhead: number;
  monthlyBreakEvenSales: number;
  dailyBreakEvenSales: number;
} {
  const totalFixedOverhead = monthlyFixedExpenses + monthlyLaborCost;
  const marginRatio = contributionMarginPercent > 0 ? contributionMarginPercent / 100 : 0;

  if (marginRatio <= 0) {
    return {
      totalFixedOverhead: roundTo2(totalFixedOverhead),
      monthlyBreakEvenSales: 0,
      dailyBreakEvenSales: 0,
    };
  }

  const monthlyBreakEvenSales = totalFixedOverhead / marginRatio;
  const dailyBreakEvenSales = monthlyBreakEvenSales / 30;

  return {
    totalFixedOverhead: roundTo2(totalFixedOverhead),
    monthlyBreakEvenSales: roundTo2(monthlyBreakEvenSales),
    dailyBreakEvenSales: roundTo2(dailyBreakEvenSales),
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
