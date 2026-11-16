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

/**
 * Calculates monthly equivalent cost of an employee (base wage + overtime + benefits).
 */
export function calculateEmployeeMonthlyCost(employee: EmployeeDoc): number {
  if (employee.isActive === false) return 0;

  let baseMonthly = 0;
  if (employee.wageType === 'monthly') {
    baseMonthly = employee.wageAmount || 0;
  } else if (employee.wageType === 'daily') {
    const days = employee.workDaysOrHoursPerMonth || 26;
    baseMonthly = (employee.wageAmount || 0) * days;
  } else if (employee.wageType === 'hourly') {
    const hours = employee.workDaysOrHoursPerMonth || 208;
    baseMonthly = (employee.wageAmount || 0) * hours;
  }

  let overtimeMonthly = 0;
  if (employee.overtimeHoursMonthly && employee.overtimeHoursMonthly > 0) {
    const hourlyRate =
      employee.wageType === 'hourly'
        ? employee.wageAmount || 0
        : employee.wageType === 'daily'
        ? (employee.wageAmount || 0) / 8
        : (employee.wageAmount || 0) / 208;
    overtimeMonthly =
      hourlyRate * employee.overtimeHoursMonthly * (employee.overtimeRateMultiplier || 1.5);
  }

  const benefits = employee.benefitsMonthly || 0;
  return baseMonthly + overtimeMonthly + benefits;
}

function isRecurringExpenseActiveInMonth(exp: ExpenseDoc, targetMonth: string): boolean {
  const startMonth = (exp.date || '').substring(0, 7);
  if (!startMonth || startMonth > targetMonth) return false;
  const endMonth =
    exp.endDate && exp.endDate.trim().length >= 7 ? exp.endDate.trim().substring(0, 7) : '';
  if (endMonth && targetMonth > endMonth) return false;
  return true;
}

function isDateInPeriod(dateStr: string, period: 'day' | 'month' | 'year', dateParam: string): boolean {
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
  summariesInPeriod?: DailySummaryDoc[]
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
    const cost = calculateEmployeeMonthlyCost(emp);
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
  summariesInPeriod?: DailySummaryDoc[]
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
  const raw = allocatePeriodExpensesAndLaborRaw(period, dateParam, expenses, employees, summariesInPeriod);
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

export interface BuildPeriodPnlInput {
  summaries: DailySummaryDoc[];
  manualSales?: DailySalesRecord[];
  expenses: ExpenseDoc[];
  employees: EmployeeDoc[];
  period: 'day' | 'month' | 'year';
  dateParam: string;
  settings: Partial<Pick<SettingsDoc, 'serviceChargeTreatment' | 'vatPercent' | 'incomeTaxRatePercent'>>;
  cogsMode: 'estimated' | 'actual';
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

  cogsStatus: PnlDataStatus;
  statusReasons: string[];
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

  for (const s of periodSummaries) {
    posDatesAll.add(s.date);
    netSalesExVatRaw += Math.max(0, s.netSales || 0);
    grossSalesRefRaw += Math.max(0, s.grossSales || 0);
    discountsRefRaw += Math.max(0, s.discounts || 0);
    serviceChargeCollectedRaw += Math.max(0, s.serviceCharge || 0);
    vatTotalRaw += Math.max(0, s.vat || 0);
    orderCount += Math.max(0, s.orderCount || 0);
    channelFeesRaw += Math.max(0, s.platformFees || 0);
    posFoodCogsRaw += Math.max(0, s.totalFoodCost || 0);
    posPackagingCogsRaw += Math.max(0, s.packagingCost || 0);

    const activeChannels = Object.entries(s.channelTotals || {}).filter(
      ([, v]) => (v?.netSales || 0) > 0 || (v?.orderCount || 0) > 0
    );
    if (activeChannels.length > 0) {
      for (const [ch] of activeChannels) {
        posDateChannelKeys.add(`${s.date}::${normalizeChannelId(ch)}`);
      }
    } else if ((s.netSales || 0) > 0 || (s.orderCount || 0) > 0) {
      posWholeDateCovered.add(s.date);
    }
  }

  // Fallback pos_sync_* entries in manualSales only when summaries lacked that date
  const posSyncEntries = periodManual.filter((r) => r.id?.startsWith('pos_sync_'));
  const manualOnlyEntries = periodManual.filter((r) => !r.id?.startsWith('pos_sync_'));

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
    if (posDatesAll.has(rec.date) || posDateChannelKeys.has(key)) {
      deduplicatedManualSkippedCount += 1;
      continue;
    }
    const recNet = resolveRecordNetSalesExVat(rec);
    posDateChannelKeys.add(key);
    netSalesExVatRaw += recNet;
    grossSalesRefRaw += Math.max(0, rec.grossSales || 0);
    discountsRefRaw += Math.max(0, rec.discounts || 0);
    refundsRefRaw += Math.max(0, rec.refunds || 0);
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
    if (posWholeDateCovered.has(rec.date) || posDateChannelKeys.has(key)) {
      deduplicatedManualSkippedCount += 1;
      continue;
    }
    const recNet = resolveRecordNetSalesExVat(rec);
    netSalesExVatRaw += recNet;
    grossSalesRefRaw += Math.max(0, rec.grossSales || 0);
    discountsRefRaw += Math.max(0, rec.discounts || 0);
    refundsRefRaw += Math.max(0, rec.refunds || 0);
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

  const scTreatment = settings.serviceChargeTreatment || 'staff_pool';
  const retainedServiceChargeRaw = scTreatment === 'retained' ? serviceChargeCollectedRaw : 0;
  const totalRevenueRaw = netSalesExVatRaw + retainedServiceChargeRaw;

  // COGS Resolution (strictly Rule 2: never silently invent fake cost rates)
  let foodCogsRaw = 0;
  let packagingCogsRaw = 0;
  let cogsStatus: PnlDataStatus = 'complete';
  const statusReasons: string[] = [];

  if (cogsMode === 'actual') {
    const hasBegin =
      actualCogsInput?.beginningInventory !== undefined &&
      actualCogsInput?.beginningInventory !== null &&
      Number.isFinite(actualCogsInput.beginningInventory);
    const hasEnd =
      actualCogsInput?.endingInventory !== undefined &&
      actualCogsInput?.endingInventory !== null &&
      Number.isFinite(actualCogsInput.endingInventory);
    const hasActual = Boolean(actualCogsInput?.hasActualData) && hasBegin && hasEnd;

    if (hasActual) {
      const beginInv = actualCogsInput!.beginningInventory || 0;
      const purchases = actualCogsInput!.purchases || 0;
      const waste = actualCogsInput!.waste || 0;
      const endInv = actualCogsInput!.endingInventory || 0;
      foodCogsRaw = beginInv + purchases - waste - endInv;
      packagingCogsRaw =
        actualCogsInput?.packagingFromOrders !== undefined
          ? actualCogsInput.packagingFromOrders
          : posPackagingCogsRaw + manualExplicitPackagingCogsRaw;
      if (foodCogsRaw < 0) {
        cogsStatus = 'incomplete';
        statusReasons.push('ต้นทุนสต็อกติดลบ กรุณาตรวจสอบสต็อกต้นงวด/ปลายงวด');
      }
    } else {
      cogsStatus = 'incomplete';
      statusReasons.push('ข้อมูลสต็อกต้นงวดหรือการจัดซื้อจริงไม่ครบ');
      foodCogsRaw = posFoodCogsRaw + manualExplicitFoodCogsRaw;
      packagingCogsRaw = posPackagingCogsRaw + manualExplicitPackagingCogsRaw;
    }
  } else {
    // 'estimated' / operational mode: POS summary snapshots + explicit manual COGS + optional real-menu-recipe rate
    foodCogsRaw = posFoodCogsRaw + manualExplicitFoodCogsRaw;
    packagingCogsRaw = posPackagingCogsRaw + manualExplicitPackagingCogsRaw;

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

  // Expenses & Labor (date-bound allocator, unrounded floats)
  const allocated = allocatePeriodExpensesAndLaborRaw(
    period,
    dateParam,
    expenses,
    employees,
    periodSummaries
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
    cogsStatus,
    statusReasons,
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
