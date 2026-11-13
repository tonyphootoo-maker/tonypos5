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

  if (Array.isArray(choice.ingredients)) {
    for (const line of choice.ingredients) {
      const ing = ingredientsMap.get(line.ingredientId);
      const effectiveCost = ing ? calculateIngredientEffectiveCost(ing) : 0;
      if (!ing || isMissingCost(effectiveCost)) {
        hasMissing = true;
      } else {
        cost += line.quantity * effectiveCost;
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
 * Backward compatibility: calculate suggested price.
 */
export function calculateSuggestedPrice(cost: number, targetFoodCostPercent: number): number {
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
 * Calculates Theoretical Food Cost %:
 * Food Cost % = Food COGS / Net Sales (net of discounts, excluding VAT, excluding service charge).
 */
export function calculateFoodCostPercent(foodCost: number, netSales: number): number {
  if (netSales <= 0 || foodCost <= 0) return 0;
  return roundTo2((foodCost / netSales) * 100);
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
 * Calculates monthly equivalent cost of an employee.
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
    const hours = employee.workDaysOrHoursPerMonth || 208;
    return employee.wageAmount * hours;
  }
  return 0;
}

/**
 * Filters and allocates expenses and labor for a given period (day, month, or year).
 * - Fixed & recurring expenses: expanded into active months from start date.
 * - One-off / variable expenses: filtered strictly by their date.
 * - Allocates monthly fixed costs/labor to a day using real days in that month,
 *   and to a year using the months actually covered (never hardcoded 30 or x12).
 */
export function calculatePeriodExpensesAndLabor(
  period: 'day' | 'month' | 'year',
  dateParam: string, // YYYY-MM-DD for day, YYYY-MM for month, YYYY for year
  expenses: ExpenseDoc[],
  employees: EmployeeDoc[],
  summariesInPeriod?: DailySummaryDoc[]
): {
  fixedExpenses: number;
  variableExpenses: number;
  operatingExpenses: number;
  laborCost: number;
  daysInPeriod: number;
  coveredMonths: number;
} {
  const monthlyLabor = employees.reduce((sum, emp) => sum + calculateEmployeeMonthlyCost(emp), 0);

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
        // Active from start month
        if (exp.date.substring(0, 7) <= targetMonth) {
          fixedExpenses += exp.amount / daysInMonth;
        }
      } else {
        // One-off matches exact day
        if (exp.date === dateParam) {
          if (exp.isFixed) {
            fixedExpenses += exp.amount;
          } else {
            variableExpenses += exp.amount;
          }
        }
      }
    }

    const laborCost = monthlyLabor / daysInMonth;
    const operatingExpenses = fixedExpenses + variableExpenses;

    return {
      fixedExpenses: roundTo2(fixedExpenses),
      variableExpenses: roundTo2(variableExpenses),
      operatingExpenses: roundTo2(operatingExpenses),
      laborCost: roundTo2(laborCost),
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
        if (exp.date.substring(0, 7) <= targetMonth) {
          fixedExpenses += exp.amount;
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

    const laborCost = monthlyLabor;
    const operatingExpenses = fixedExpenses + variableExpenses;

    return {
      fixedExpenses: roundTo2(fixedExpenses),
      variableExpenses: roundTo2(variableExpenses),
      operatingExpenses: roundTo2(operatingExpenses),
      laborCost: roundTo2(laborCost),
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

  // Determine endMonth (up to current month if current year, 12 if past year, or latest summary month)
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
    // Past year: up to December unless capped, usually full year 12 from startMonth
    endMonth = 12;
  }

  let startMonth = 1;
  const observedMonths = [...summaryMonths, ...expenseMonthsInYear];
  if (observedMonths.length > 0) {
    startMonth = Math.min(...observedMonths);
  }

  // Ensure startMonth <= endMonth
  const activeMonthNumbers: number[] = [];
  if (endMonth >= startMonth && endMonth >= 1) {
    for (let m = startMonth; m <= endMonth; m++) {
      activeMonthNumbers.push(m);
    }
  }

  let totalFixed = 0;
  let totalVariable = 0;
  let totalLabor = 0;
  let totalDays = 0;

  for (const m of activeMonthNumbers) {
    const mStr = `${targetYear}-${String(m).padStart(2, '0')}`;
    totalDays += getDaysInMonth(targetYearNum, m);
    for (const exp of expenses) {
      if (exp.isRecurring) {
        if (exp.date.substring(0, 7) <= mStr) {
          totalFixed += exp.amount;
        }
      }
    }
    totalLabor += monthlyLabor;
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

  return {
    fixedExpenses: roundTo2(totalFixed),
    variableExpenses: roundTo2(totalVariable),
    operatingExpenses: roundTo2(totalFixed + totalVariable),
    laborCost: roundTo2(totalLabor),
    daysInPeriod: totalDays || 365,
    coveredMonths: activeMonthNumbers.length,
  };
}

export type BenchmarkStatus = 'good' | 'warning' | 'danger';

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
 * Centralized USALI Profit & Loss (Income Statement) computation from Daily Summaries,
 * allocated expenses, labor, and accounting settings.
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
  let netSales = 0;
  let grossSales = 0;
  let discounts = 0;
  let totalFoodCost = 0;
  let platformFees = 0;
  let packagingCost = 0;
  let serviceChargeCollected = 0;
  let vatTotal = 0;
  let orderCount = 0;

  for (const s of summaries) {
    netSales += s.netSales || 0;
    grossSales += s.grossSales || 0;
    discounts += s.discounts || 0;
    totalFoodCost += s.totalFoodCost || 0;
    platformFees += s.platformFees || 0;
    packagingCost += s.packagingCost || 0;
    serviceChargeCollected += s.serviceCharge || 0;
    vatTotal += s.vat || 0;
    orderCount += s.orderCount || 0;
  }

  netSales = roundTo2(netSales);
  grossSales = roundTo2(grossSales);
  discounts = roundTo2(discounts);
  totalFoodCost = roundTo2(totalFoodCost);
  platformFees = roundTo2(platformFees);
  packagingCost = roundTo2(packagingCost);
  serviceChargeCollected = roundTo2(serviceChargeCollected);
  vatTotal = roundTo2(vatTotal);

  const retainedServiceCharge = serviceChargeTreatment === 'retained' ? serviceChargeCollected : 0;
  const totalRevenue = roundTo2(netSales + retainedServiceCharge);

  // Theoretical Food Cost % is always Food COGS / Net Food Sales
  const theoreticalFoodCostPercent = netSales > 0 ? roundTo2((totalFoodCost / netSales) * 100) : 0;

  // USALI Gross Profit = Net Sales - Food COGS (+ Retained SC if retained)
  const grossProfit = roundTo2(totalRevenue - totalFoodCost);
  const grossProfitMarginPercent = totalRevenue > 0 ? roundTo2((grossProfit / totalRevenue) * 100) : 0;

  const {
    fixedExpenses,
    variableExpenses,
    operatingExpenses,
    laborCost,
    daysInPeriod,
    coveredMonths,
  } = periodExpensesAndLabor;

  // Prime Cost = Food COGS + Labor Cost
  const primeCost = roundTo2(totalFoodCost + laborCost);
  const primeCostPercent = totalRevenue > 0 ? roundTo2((primeCost / totalRevenue) * 100) : 0;
  const laborPercent = totalRevenue > 0 ? roundTo2((laborCost / totalRevenue) * 100) : 0;

  // Net Operating Profit = Gross Profit - Packaging - Platform Commissions - Labor - Operating Expenses
  const netOperatingProfit = roundTo2(
    grossProfit - packagingCost - platformFees - laborCost - operatingExpenses
  );
  const netProfitMarginPercent = totalRevenue > 0 ? roundTo2((netOperatingProfit / totalRevenue) * 100) : 0;
  const avgOrderValue = orderCount > 0 ? roundTo2(netSales / orderCount) : 0;

  return {
    netSales,
    retainedServiceCharge,
    totalRevenue,
    totalFoodCost,
    theoreticalFoodCostPercent,
    grossProfit,
    grossProfitMarginPercent,
    packagingCost,
    platformFees,
    laborCost,
    laborPercent,
    laborStatus: getLaborCostStatus(laborPercent),
    fixedExpenses,
    variableExpenses,
    operatingExpenses,
    primeCost,
    primeCostPercent,
    primeCostStatus: getPrimeCostStatus(primeCostPercent),
    netOperatingProfit,
    netProfitMarginPercent,
    orderCount,
    avgOrderValue,
    grossSales,
    discounts,
    vatTotal,
    serviceChargeCollected,
    coveredMonths,
    daysInPeriod,
  };
}

/**
 * Derives variable cost % from real data of recent daily summaries:
 * variable cost % = (food + packaging + platformFees) / netSales
 * CM % = 100 - variable cost %
 */
export function deriveVariableCostPercent(recentSummaries: DailySummaryDoc[]): {
  variableCostPercent: number;
  contributionMarginPercent: number;
  hasRealData: boolean;
  totalNetSales: number;
} {
  let netSales = 0;
  let variableCosts = 0;

  for (const s of recentSummaries) {
    netSales += s.netSales || 0;
    variableCosts += (s.totalFoodCost || 0) + (s.packagingCost || 0) + (s.platformFees || 0);
  }

  if (netSales > 0 && variableCosts > 0) {
    const vcPct = roundTo2((variableCosts / netSales) * 100);
    const cmPct = roundTo2(Math.max(0, Math.min(100, 100 - vcPct)));
    return {
      variableCostPercent: vcPct,
      contributionMarginPercent: cmPct,
      hasRealData: true,
      totalNetSales: roundTo2(netSales),
    };
  }

  // Default estimate when not enough data
  return {
    variableCostPercent: 35,
    contributionMarginPercent: 65,
    hasRealData: false,
    totalNetSales: 0,
  };
}

/**
 * Calculates break-even sales:
 * Break-even Sales = Total Fixed Overhead / Contribution Margin %
 * Daily Break-even = Monthly / Operating Days
 */
export function calculateBreakEven(
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
