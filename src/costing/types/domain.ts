/**
 * Domain Types for Restaurant Cost & Profit Management System
 */

export type UnitType =
  | 'g'
  | 'kg'
  | 'mg'
  | 'ml'
  | 'l'
  | 'piece'
  | 'pack'
  | 'bottle'
  | 'box'
  | 'can'
  | 'bag'
  | 'egg'
  | 'tbsp'
  | 'tsp'
  | 'cup'
  | 'portion'
  | 'serving'
  | 'custom';

export type YieldType =
  | 'loss' // Trimming, peeling, butchering loss (Yield <= 100%)
  | 'absorption' // Boiling rice, cooking dry noodles, soaking beans (Yield >= 100%)
  | 'cooking_reduction'; // Sauce reduction, baking moisture loss (Yield <= 100%)

export type IngredientCategory =
  | 'Meat & Poultry'
  | 'Seafood'
  | 'Vegetables & Herbs'
  | 'Sauces & Condiments'
  | 'Dairy & Eggs'
  | 'Dry Goods & Grains'
  | 'Oils & Fats'
  | 'Spices & Seasonings'
  | 'Packaging'
  | 'Beverages'
  | 'Other';

export interface PriceHistoryRecord {
  id: string;
  date: string; // YYYY-MM-DD
  price: number;
  quantity: number;
  unit: UnitType;
  supplierId?: string;
  supplierName?: string;
  notes?: string;
}

export interface Ingredient {
  id: string;
  code: string;
  thaiName: string;
  englishName: string;
  category: IngredientCategory;
  purchaseUnit: UnitType;
  purchaseQuantity: number;
  purchasePrice: number; // Purchase price for purchaseQuantity
  supplierId?: string;
  supplierName?: string;
  preparationMethod?: string;
  yieldType: YieldType;
  yieldPercent: number; // e.g. 95 for 95%, 240 for 240% noodle expansion
  usableQuantity: number; // calculated: purchaseQuantity * (yieldPercent / 100)
  effectiveCost: number; // cost per usable purchaseUnit: purchasePrice / usableQuantity
  baseUnit: 'g' | 'ml' | 'piece' | 'egg';
  costPerBaseUnit: number; // cost per 1 g, 1 ml, or 1 piece
  minimumStock: number;
  currentStock: number;
  active: boolean;
  notes?: string;
  priceHistory: PriceHistoryRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface UnitConversionRule {
  fromUnit: UnitType;
  toUnit: UnitType;
  factor: number; // toUnit = fromUnit * factor
  density?: number; // g/ml if cross-type
  ingredientId?: string; // specific ingredient override
}

export interface SubRecipeItem {
  id: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: UnitType;
  unitCost: number; // cost per specified unit
  extendedCost: number; // quantity * unitCost
}

export interface SubRecipe {
  id: string;
  code: string;
  thaiName: string;
  englishName: string;
  category: 'Sauce' | 'Prepared Grain' | 'Paste & Curry' | 'Garnish & Prep' | 'Base Stock' | 'Other';
  description?: string;
  notes?: string;
  items: SubRecipeItem[];
  preparationYieldPercent: number; // e.g. 90% after boiling/evaporation or 100%
  batchQuantity: number; // expected raw batch quantity
  finalBatchQuantity: number; // after yield: batchQuantity * (yield / 100)
  outputUnit: UnitType; // e.g. 'ml', 'g', 'portion'
  batchCost: number; // SUM(items extendedCost)
  costPerFinalUnit: number; // batchCost / finalBatchQuantity
  active: boolean;
  dependentMenuIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export type RecipeItemType = 'ingredient' | 'sub_recipe' | 'packaging' | 'other';

export interface RecipeItem {
  id: string;
  type: RecipeItemType;
  itemId: string; // ingredientId or subRecipeId or packagingId
  itemName: string;
  quantity: number;
  unit: UnitType;
  unitCost: number;
  extendedCost: number;
  notes?: string;
}

export interface PortionVariant {
  id: string;
  name: string; // 'Regular', 'Large', 'Special', 'Extra Meat'
  portionMultiplier: number; // e.g. 1.0, 1.4, etc.
  customItems?: RecipeItem[]; // override items if variant has different composition
  sellingPrice: number;
  directFoodCost: number;
  packagingCost: number;
  totalDirectCost: number;
  targetFoodCostPercent: number;
  foodCostPercent: number;
  grossMarginPercent: number;
  contributionProfit: number;
}

export interface MenuItem {
  id: string;
  code: string;
  name?: string;
  thaiName: string;
  englishName: string;
  category: string;
  description?: string;
  photoUrl?: string;
  items: RecipeItem[];
  portions: PortionVariant[];
  targetFoodCostPercent: number; // default e.g. 30%
  targetGrossMarginPercent: number; // default e.g. 70%
  pricingMethod: 'food_cost_target' | 'gross_margin_target';
  packagingId?: string;
  packagingCost: number;
  active: boolean;
  salesVolumeMonthly?: number;
  channelPrices?: Record<string, number>; // channelId -> custom selling price
  createdAt: string;
  updatedAt: string;
}

export interface SalesChannel {
  id: string;
  code: string;
  name: string; // 'Dine-in', 'Takeaway', 'GrabFood', 'LINE MAN', 'ShopeeFood', 'Robinhood'
  commissionPercent: number; // e.g. 0% for dine-in, 30% for Grab
  paymentFeePercent: number; // e.g. 0% or 2.5%
  fixedFeePerOrder: number; // e.g. 0 or 3 THB
  packagingFeeSurcharge: number; // added to customer bill or borne by restaurant
  taxOnCommissionPercent: number; // 7% VAT on platform commission
  gpBase?: 'gross_incl_vat' | 'net_ex_vat'; // GP calculation basis: gross (default) vs ex-VAT
  active: boolean;
  notes?: string;
}

export interface PackagingItem {
  id: string;
  code: string;
  thaiName: string;
  englishName: string;
  category: 'Box' | 'Bag' | 'Cup & Lid' | 'Cutlery & Napkin' | 'Sauce Container' | 'Other';
  unitCost: number;
  stockQuantity: number;
  supplier?: string;
  active: boolean;
}

export type ExpenseCategory =
  | 'Rent'
  | 'Electricity'
  | 'Water'
  | 'Gas (LPG)'
  | 'Internet & Telephone'
  | 'Labor (Salary & Wages)'
  | 'Marketing & Ads'
  | 'Cleaning & Sanitation'
  | 'Repair & Maintenance'
  | 'Transportation & Fuel'
  | 'POS & Software Subscriptions'
  | 'Bank & Credit Card Fees'
  | 'Packaging Purchases'
  | 'Licenses & Permits'
  | 'Insurance'
  | 'Depreciation'
  | 'Other Operating Expenses';

export type ExpenseFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface ExpenseRecord {
  id: string;
  date: string;
  endDate?: string;
  category: ExpenseCategory | string;
  name?: string;
  description: string;
  amount: number;
  isFixed?: boolean; // Fixed vs Variable
  isPayroll?: boolean; // Explicit flag replacing keyword matching
  paymentMethod: 'Cash' | 'Bank Transfer' | 'Credit Card' | 'PromptPay' | string;
  recurring?: boolean;
  frequency?: ExpenseFrequency;
  operatingDaysPerMonth?: number;
  isExcluded?: boolean;
  isInstallment?: boolean;
  monthlyInstallment?: number;
  assetCost?: number;
  usefulLifeYears?: number;
  supplierName?: string;
  taxAmount?: number;
  receiptNumber?: string;
  notes?: string;
  createdAt?: string;
}

export interface Employee {
  id: string;
  name: string;
  position: string;
  type?: 'hourly' | 'daily' | 'monthly';
  roleCategory?: 'direct_kitchen' | 'direct_service' | 'indirect_management';
  wageRate?: number; // rate per hour, day, or month in THB
  standardHoursPerMonth?: number;
  overtimeHoursMonthly?: number;
  overtimeRateMultiplier?: number;
  benefitsMonthly?: number;
  active: boolean;
  role?: string;
  department?: 'kitchen' | 'front_of_house' | 'management';
  employmentType?: 'full_time' | 'part_time' | 'hourly';
  baseSalary?: number;
  hourlyRate?: number;
  hoursPerMonth?: number;
  monthlyCost?: number;
}

export interface DailySalesRecord {
  id: string;
  date: string;
  channelId: string;
  channelName: string;
  orderCount: number;
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  isVatInclusive?: boolean;
  vatRatePercent?: number;
  platformFees: number;
  actualPayout: number;
  serviceCharge?: number;
  foodCost?: number;
  packagingCost?: number;
  deliveryFeeTotal?: number;
  cashSalesTotal?: number;
  qrSalesTotal?: number;
  source?: 'pos' | 'online' | 'manual';
  estimatedAllocation?: boolean;
  replacesPosSync?: boolean;
  itemSales?: {
    menuItemId: string;
    portionId: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
  }[];
}

export type WasteReason =
  | 'Expired'
  | 'Spoiled / Mold'
  | 'Overproduction'
  | 'Cooking / Burn Loss'
  | 'Customer Return'
  | 'Damaged Packaging'
  | 'Dropped / Spilled'
  | 'Other';

export interface WasteRecord {
  id: string;
  date: string;
  ingredientId?: string;
  ingredientName: string;
  subRecipeId?: string;
  quantity: number;
  unit: UnitType;
  unitCost: number;
  totalCost: number;
  reason: WasteReason;
  responsiblePerson?: string;
  notes?: string;
}

export interface InventoryRecord {
  id: string;
  ingredientId: string;
  ingredientName: string;
  period: string; // YYYY-MM
  beginningStock: number;
  beginningValue: number;
  purchasesQty: number;
  purchasesValue: number;
  wasteQty: number;
  wasteValue: number;
  adjustmentsQty: number;
  endingStock: number;
  endingValue: number;
  calculatedCOGS: number; // Beginning + Purchases - Ending
}

export interface StockCountItem {
  ingredientId: string;
  ingredientName: string;
  countedQty: number;
  unit: UnitType;
  costPerUnit: number;
  totalValue: number;
}

export interface StockCountSnapshot {
  id: string;
  date: string; // YYYY-MM-DD
  totalValue: number; // Σ countedQty × costPerUnit
  items?: StockCountItem[];
  notes?: string;
  countedBy?: string;
  createdAt?: string;
}

export interface BusinessSettings {
  restaurantName: string;
  currency?: string; // '฿' or 'THB'
  vatRatePercent?: number; // default 7% VAT
  incomeTaxRatePercent?: number; // default 20% estimated corporate income tax
  /** @deprecated Do not read in calculations. Use vatRatePercent or incomeTaxRatePercent instead. */
  taxRatePercent?: number;
  defaultTargetFoodCostPercent?: number; // e.g. 30%
  defaultTargetGrossMarginPercent?: number; // e.g. 70%
  targetFoodCostPercent?: number;
  defaultPricingMethod?: 'food_cost_target' | 'gross_margin_target';
  cogsCalculationMode?: 'recipe_operational' | 'inventory_accounting';
  laborTargetPercent?: number; // e.g. 20%
  primeCostTargetPercent?: number; // e.g. 55%
  operatingDaysPerMonth?: number; // e.g. 26 or 30
  cogsVarianceThresholdPercent?: number; // e.g. 3.0 percentage points of net sales
  socialSecurityEnabled?: boolean;
  socialSecurityRatePercent?: number;
  socialSecurityCapWage?: number;
  serviceChargeTreatment?: 'staff_pool' | 'retained';
  primaryLanguage?: 'th' | 'en';
  pricesIncludeVat?: boolean;
  salesVatInclusive?: boolean;
  serviceChargeIncludedInPrice?: boolean;
  serviceChargePercent?: number;
  defaultOverheadCostPerDish?: number;
  overheadRatePercent?: number;
  overheadCalculationBase?: 'SELLING_PRICE' | 'FOOD_COST';
  targetProfitAmount?: number;
  takeawayPackagingCost?: number;
  deliveryPackagingCost?: number;
  grabFoodCommissionPercent?: number;
  grabFoodCommissionHasVat?: boolean;
  lineManCommissionPercent?: number;
  lineManCommissionHasVat?: boolean;
  commissionVatAsCost?: boolean;
  priceRounding?: 1 | 5 | 10;
  defaultTicketSize?: number;
}

export interface WhatShouldIDoAdvice {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'OPPORTUNITY' | 'INFO';
  category: 'Food Cost' | 'Price Increase' | 'Delivery Loss' | 'Menu Engineering' | 'Break-Even' | 'Waste';
  titleTh: string;
  titleEn: string;
  descriptionTh: string;
  descriptionEn: string;
  actionRecommendationTh: string;
  actionRecommendationEn: string;
  metricLabel: string;
  metricValue: string;
  impactAmountThb?: number;
  relatedEntityId?: string;
  relatedEntityType?: 'ingredient' | 'menu' | 'channel' | 'recipe';
}

export interface ExcelMappingRow {
  sheetName: string;
  excelCellOrRange: string;
  excelFormula: string;
  businessMeaning: string;
  applicationFunction: string;
  sampleExpectedResult: string;
  status: 'VERIFIED' | 'NORMALIZED' | 'IMPROVED';
}

export interface ReconciliationComparison {
  menuId: string;
  menuCode: string;
  menuNameTh: string;
  excelFoodCost: number;
  appFoodCost: number;
  costDifference: number;
  costDifferencePercent: number;
  excelSellingPrice: number;
  appSellingPrice: number;
  excelFoodCostPercent: number;
  appFoodCostPercent: number;
  excelGrossProfit: number;
  appGrossProfit: number;
  status: 'MATCH' | 'WARNING' | 'MISMATCH';
  notes: string;
}

export type ActiveView =
  | 'dashboard'
  | 'ingredients'
  | 'yield-calculator'
  | 'sub-recipes'
  | 'menu-items'
  | 'recipe-builder'
  | 'menu-engineering'
  | 'pricing-simulator'
  | 'channels'
  | 'packaging'
  | 'sales-entry'
  | 'expenses'
  | 'labor'
  | 'pnl'
  | 'breakeven'
  | 'waste'
  | 'inventory'
  | 'reconciliation'
  | 'excel-mapping'
  | 'test-suite'
  | 'settings';

export interface YieldTestRecord {
  id: string;
  ingredientId: string;
  ingredientName: string;
  testDate: string;
  rawWeight: number;
  usableWeight: number;
  lossWeight: number;
  yieldPercent: number;
  rawCost: number;
  usableUnitCost: number;
  notes?: string;
}

export type PortionSize = PortionVariant;

export interface TestSuiteResult {
  testId: string;
  functionName: string;
  testDescription: string;
  inputs: Record<string, any>;
  expectedOutput: number | string;
  actualOutput: number | string;
  difference: number;
  status: 'PASS' | 'FAIL';
  executionTimeMs: number;
}

