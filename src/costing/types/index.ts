export type UnitType =
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'ตัว'
  | 'ฟอง'
  | 'ชิ้น'
  | 'แพ็ค'
  | 'ขวด'
  | 'จาน'
  | 'ถ้วย'
  | 'มัด'
  | 'ชุด';

export type IngredientCategory =
  | 'เนื้อสัตว์และอาหารทะเล'
  | 'ผักและสมุนไพร'
  | 'เครื่องปรุงและซอส'
  | 'ข้าวและเส้น'
  | 'ไข่และเต้าหู้'
  | 'ของแห้งและเบ็ดเตล็ด'
  | 'บรรจุภัณฑ์';

export type UserRole = 'OWNER' | 'MANAGER' | 'STAFF';

export type SalesChannel = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | string;

export interface Ingredient {
  id: string;
  code?: string; // Optional SKU or barcode
  name: string;
  category: IngredientCategory;
  purchaseQuantity: number;
  purchaseUnit: UnitType;
  purchasePrice: number; // in THB
  actualQuantity: number;
  actualUnit: UnitType;
  yieldPercent: number; // e.g. 95 for 95%
  actualCost: number; // calculated: purchasePrice * (100 / yieldPercent)
  baseUnit: UnitType;
  costPerBaseUnit: number; // calculated: actualCost / actualQuantity
  usageUnit: UnitType; // the unit used in recipes (e.g. g, ตัว, ml, ฟอง)
  pricePerPack?: number; // legacy alias of purchasePrice
  packQuantity?: number; // legacy alias of purchaseQuantity
  packUnit?: UnitType; // legacy alias of purchaseUnit
  recipeUnit?: UnitType; // legacy alias of usageUnit
  piecesPerPurchaseUnit?: number; // for shrimp or piece-based items (e.g. 60 pieces per purchase)
  active: boolean;
  notes?: string;
  preparationMethod?: string;
  yieldType?: 'loss' | 'absorption' | 'cooking_reduction';
  isReviewRequired?: boolean;
  reviewReason?: string;
  supplierId?: string;
  supplierName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceHistoryRecord {
  id: string;
  ingredientId: string;
  ingredientName: string;
  oldPrice: number;
  newPrice: number;
  oldCostPerUnit: number;
  newCostPerUnit: number;
  unit: UnitType;
  date: string;
  reason: string;
  user: string;
}

export interface SauceRecipeItem {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: UnitType;
  unitCost: number;
  lineCost: number;
  isReviewRequired?: boolean;
}

export interface Sauce {
  id: string;
  code?: string;
  name: string;
  thaiName?: string;
  englishName?: string;
  category?: string;
  description?: string;
  productionQuantity: number;
  productionUnit: UnitType;
  yieldPercent: number;
  actualQuantity: number;
  productionCost: number; // SUM(lineCost)
  actualCost: number; // productionCost * (100 / yieldPercent)
  costPerGram: number; // actualCost / actualQuantity
  items: SauceRecipeItem[];
  active: boolean;
  notes?: string;
  isReviewRequired?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RecipeItemType = 'INGREDIENT' | 'SAUCE' | 'PREPARED_ITEM' | 'PACKAGING' | 'OTHER';

export interface RecipeItem {
  id?: string;
  type?: RecipeItemType;
  ingredientType?: RecipeItemType;
  ingredientId: string;
  sauceId?: string;
  name: string;
  quantity: number;
  unit: UnitType;
  isSeafoodSpecialty?: boolean; // For explicit Shrimp or Squid tracking
  proteinCategory?: 'SHRIMP' | 'SQUID' | 'PORK' | 'CHICKEN' | 'BEEF' | 'OTHER';
  calculatedUnitCost?: number;
  calculatedLineCost?: number;
  isReviewRequired?: boolean;
  missingPrice?: boolean;
}

export interface PackagingLineItem {
  id: string;
  name: string;
  cost: number;
}

export interface MenuVariant {
  id: string;
  menuId?: string;
  code?: string; // e.g. "MK-01-PORK"
  sku?: string; // POS SKU mapping
  barcode?: string;
  name: string; // e.g. "กะเพราหมูหมัก", "กะเพราทะเล"
  proteinType: string; // "หมูหมัก" | "หมูบด" | "ไก่" | "เนื้อ" | "กุ้ง" | "ปลาหมึก" | "ทะเล"
  sellingPrice: number; // Dine-in price
  takeawayPrice: number; // Takeaway price
  deliveryPrice: number; // Delivery price
  grabPrice?: number; // Grab Food specific price
  linemanPrice?: number; // Line Man specific price
  robinhoodPrice?: number; // Robinhood specific price
  recipeItems: RecipeItem[];
  overheadCost: number; // specific or inherited
  packagingCost?: number; // total packaging cost
  packagingItems?: PackagingLineItem[]; // line items for packaging
  directFoodCost?: number; // snapshot or precalculated direct food cost
  kitchenStation?: string; // e.g. 'WOK', 'FRY', 'PREP'
  taxType?: 'INCLUSIVE' | 'EXCLUSIVE' | 'NONE';
  active: boolean;
  isOutOfStock?: boolean; // POS availability flag: out of stock in kitchen
  availableChannels?: string[]; // e.g. ['DINE_IN', 'TAKEAWAY', 'GRAB', 'LINEMAN']
  isReviewRequired?: boolean;
}

export interface MenuItem {
  id: string;
  code?: string; // e.g. "MK-01"
  sku?: string;
  barcode?: string;
  name: string; // e.g. "กะเพรา", "ข้าวผัด", "ต้มยำ"
  category: string;
  description?: string;
  active: boolean;
  isOutOfStock?: boolean;
  availableChannels?: string[];
  displayOrder?: number;
  variants: MenuVariant[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RecipeCostBreakdown {
  variantId: string;
  variantName: string;
  menuName: string;
  proteinType: string;
  sellingPrice: number;
  takeawayPrice: number;
  deliveryPrice: number;
  netDineInSellingPrice?: number;
  netTakeawaySellingPrice?: number;

  // Breakdown components
  shrimpCost: number;
  squidCost: number;
  seafoodTotalCost: number; // shrimpCost + squidCost, but always tracked separately!
  meatCost: number;
  sauceCost: number;
  centralIngredientCost: number;
  totalIngredientCost: number;
  totalFoodCost?: number;
  overheadCost: number;
  packagingCost: number;
  totalCost: number;
  totalCostWithOverhead?: number;

  // Profitability
  restaurantProfit: number;
  restaurantFoodCostPercent: number;
  restaurantMarginPercent: number;
  foodCostPercent?: number;
  isLowMargin?: boolean;

  takeawayProfit: number;
  takeawayPackagingCost: number;
  takeawayFoodCostPercent: number;

  deliveryCommissionPercent: number;
  deliveryCommissionAmount: number;
  deliveryCommissionFee?: number;
  deliveryPackagingCost: number;
  deliveryProfit: number;
  deliveryFoodCostPercent: number;
  deliveryMarginPercent?: number;

  // Pricing suggestions
  suggestedPriceByTargetFoodCost: number;
  suggestedPriceByTargetProfit: number;

  hasReviewIssue: boolean;
  reviewMessage?: string;
  hasMissingPrice?: boolean;
  missingPrice?: boolean;
  items: RecipeItem[];
}

export interface ChannelSettings {
  channelId: string;
  channelName: string;
  commissionPercent: number; // e.g. 30%
  fixedFee: number;
  packagingCost: number;
  otherFee: number;
  active: boolean;
}

export type OverheadCalculationBase = 'SELLING_PRICE' | 'FOOD_COST';

export interface RestaurantSettings {
  restaurantName: string;
  defaultOverheadCostPerDish: number;
  defaultOverheadCost?: number;
  overheadRatePercent?: number; // อัตราโสหุ้ย (%) / Overhead rate (%)
  overheadCalculationBase?: OverheadCalculationBase; // คิดโสหุ้ยจาก: 'SELLING_PRICE' (DEFAULT) หรือ 'FOOD_COST'
  targetFoodCostPercent: number;
  defaultTargetFoodCostPercent?: number;
  targetProfitAmount?: number;
  operatingDaysPerMonth?: number;
  primeCostTargetPercent?: number;
  vatRatePercent?: number; // default 7% VAT
  incomeTaxRatePercent?: number; // default 20% estimated corporate income tax
  /** @deprecated Do not read in calculations. Use vatRatePercent or incomeTaxRatePercent instead. */
  taxRatePercent?: number;
  takeawayPackagingCost: number;
  packagingCostTakeaway?: number;
  deliveryPackagingCost: number;
  grabFoodCommissionPercent?: number;
  grabFoodCommissionHasVat?: boolean; // C-01: delivery GP must include 7% VAT: effective GP = GP% * 1.07 (defaults to true)
  lineManCommissionPercent?: number;
  lineManCommissionHasVat?: boolean; // C-01: delivery GP must include 7% VAT (defaults to true)
  channels: ChannelSettings[];
  userRole: UserRole;
  cogsVarianceThresholdPercent?: number; // e.g. 3.0 percentage points of net sales
  projectedMonthlySales?: number;
  salesVatInclusive?: boolean;
}

export interface InventoryItem {
  id?: string;
  ingredientId: string;
  ingredientName: string;
  category?: string;
  currentStock: number; // Canonical field
  currentQuantity?: number; // Backward-compatible legacy alias
  unit: UnitType;
  minStock: number; // Canonical field
  minimumStock?: number; // Backward-compatible legacy alias
  maxStock?: number; // Canonical field
  maximumStock?: number; // Backward-compatible legacy alias
  costPerUnit?: number;
  lastUpdated: string;
}

export type InventoryTransactionType =
  | 'PURCHASE'
  | 'USAGE'
  | 'ADJUSTMENT'
  | 'WASTE'
  | 'STOCK_COUNT';

export interface InventoryTransaction {
  id: string;
  inventoryItemId?: string;
  ingredientId: string;
  ingredientName: string;
  type: InventoryTransactionType;
  quantity?: number;
  quantityChange?: number;
  resultingQuantity?: number;
  unit: UnitType;
  date: string;
  reason: string;
  notes?: string;
  cost?: number;
  user: string;
  referenceId?: string; // e.g. saleOrderId, purchaseId, wasteId
}

export interface WasteRecord {
  id: string;
  date: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: UnitType;
  cost?: number; // Canonical / backward-compatible cost field
  totalCost?: number; // Canonical / backward-compatible cost field
  unitCost?: number;
  reason?: string;
  reasonText?: string;
  notes?: string;
  user: string;
}

export interface PurchaseRecord {
  id: string;
  invoiceNumber?: string;
  date: string;
  supplierId?: string;
  supplierName: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: UnitType;
  unitPrice?: number;
  price?: number;
  totalPrice?: number;
  yieldPercent?: number;
  actualQuantity?: number;
  costPerUnit?: number;
  notes?: string;
  createdAt?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  category: string;
  phone?: string;
  address?: string;
  notes?: string;
  active: boolean;
}

export type ExpenseCategory =
  | 'ค่าเช่า'
  | 'ค่าเช่าที่'
  | 'ค่าไฟ'
  | 'ค่าน้ำ'
  | 'ค่าแก๊ส'
  | 'ค่าแรง'
  | 'ค่าจ้างพนักงาน'
  | 'ค่าแพ็กเกจจิ้ง'
  | 'บรรจุภัณฑ์'
  | 'ค่า GP / Commission'
  | 'ค่าโฆษณา'
  | 'การตลาด'
  | 'ค่าวัตถุดิบ'
  | 'ค่าอุปกรณ์'
  | 'ซ่อมบำรุง'
  | 'เบ็ดเตล็ด'
  | 'อื่น ๆ';

export type ExpenseFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface ExpenseRecord {
  id: string;
  date: string;
  category: ExpenseCategory | string;
  name?: string;
  description: string;
  amount: number;
  isFixed?: boolean;
  paymentMethod: 'เงินสด' | 'โอนเงิน' | 'บัตรเครดิต' | 'CASH' | 'TRANSFER' | 'CREDIT' | string;
  frequency?: ExpenseFrequency;
  operatingDaysPerMonth?: number;
  isExcluded?: boolean;
  isInstallment?: boolean;
  monthlyInstallment?: number;
  assetCost?: number;
  usefulLifeYears?: number;
  notes?: string;
  createdAt?: string;
}

export interface SaleOrderItem {
  menuId?: string;
  variantId: string;
  menuName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  foodCostPerUnit: number; // Snapshot of food cost at sale time
  totalPrice: number;
  totalFoodCost: number; // Snapshot of total food cost at sale time
  notes?: string;
  recipeSnapshot?: Array<{
    ingredientId: string;
    name: string;
    quantity: number;
    unit: string;
    unitCost: number;
    lineCost: number;
  }>;
}

export interface SaleOrder {
  id: string;
  orderNumber: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  channel: string; // 'ร้าน' | 'GrabFood' | 'LINE MAN' | 'Takeaway' | 'DINE_IN' | 'DELIVERY'
  items: SaleOrderItem[];
  grossSales: number;
  commissionFee: number;
  commissionPercent?: number;
  packagingCost: number;
  totalFoodCost: number;
  grossProfit: number;
  netRevenue?: number;
  notes?: string;
  createdAt?: string;

  // POS Readiness Extensions (Optional, backward-compatible)
  subtotal?: number;
  discountAmount?: number;
  discountReason?: string;
  taxAmount?: number;
  paymentStatus?: 'PAID' | 'PENDING' | 'VOID' | 'REFUNDED';
  paymentMethod?: 'CASH' | 'PROMPTPAY' | 'CREDIT_CARD' | 'DELIVERY' | 'OTHER' | string;
  orderStatus?: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  tableNumber?: string;
  guestCount?: number;
  cashierShiftId?: string;
  updatedAt?: string;
}

export interface DailyPnL {
  date: string;
  grossSales: number;
  foodCost: number;
  platformFees: number;
  packagingFees: number;
  operatingExpenses: number;
  grossProfit: number;
  netProfit: number;
  foodCostPercent: number;
  ordersCount: number;
}

// Migrated Models from domain.ts (Single Source of Truth)

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
  testedBy?: string;
}

export interface Employee {
  id: string;
  name: string;
  position: string;
  type?: 'hourly' | 'daily' | 'monthly';
  roleCategory?: 'direct_kitchen' | 'direct_service' | 'indirect_management';
  wageRate?: number;
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

export interface PackagingItem {
  id: string;
  code?: string;
  thaiName: string;
  englishName?: string;
  category?: 'Box' | 'Bag' | 'Cup & Lid' | 'Cutlery & Napkin' | 'Sauce Container' | 'Other' | string;
  unitCost: number;
  stockQuantity?: number;
  supplier?: string;
  active: boolean;
  notes?: string;
}

export interface WhatShouldIDoAdvice {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'OPPORTUNITY' | 'INFO';
  category: 'Food Cost' | 'Price Increase' | 'Delivery Loss' | 'Menu Engineering' | 'Break-Even' | 'Waste' | string;
  titleTh: string;
  titleEn?: string;
  descriptionTh: string;
  descriptionEn?: string;
  actionRecommendationTh: string;
  actionRecommendationEn?: string;
  metricLabel: string;
  metricValue: string;
  impactAmountThb?: number;
  relatedEntityId?: string;
  relatedEntityType?: 'ingredient' | 'menu' | 'channel' | 'recipe';
}

// Unified Local-First Backup/Restore Package
export interface AppBackupPackage {
  schemaVersion: '1.0.0' | '1.1.0' | string;
  appId: 'TONYS_KITCHEN_POS';
  appName: string;
  exportedAt: string; // ISO 8601
  overheadPercentOfSales?: number;
  payload: {
    settings: RestaurantSettings;
    ingredients: Ingredient[];
    sauces: Sauce[];
    menus: MenuItem[];
    suppliers: Supplier[];
    inventory: InventoryItem[];
    inventoryTransactions: InventoryTransaction[];
    purchases: PurchaseRecord[];
    priceHistory: PriceHistoryRecord[];
    expenses: ExpenseRecord[];
    salesOrders: SaleOrder[];
    wasteLog: WasteRecord[];
    dailySales?: any[];
    yieldTests?: YieldTestRecord[];
    employees?: Employee[];
    packagingItems?: PackagingItem[];
  };
}

