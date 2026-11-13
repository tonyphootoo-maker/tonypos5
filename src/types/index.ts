export type Language = 'th' | 'en';
export type SyncStatus = 'online' | 'offline' | 'syncing';

export type BillStatus = 'saved' | 'paid' | 'voided';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type PaymentMethod = 'cash' | 'qr' | 'card' | 'transfer';
export type TableShape = 'square' | 'round' | 'rectangle';
export type WageType = 'monthly' | 'daily' | 'hourly';
export type ExpenseType = 'fixed' | 'variable';

export interface BaseDoc {
  id: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  version: number;
}

export interface SettingsDoc extends BaseDoc {
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  taxId: string;
  receiptHeader: string;
  receiptFooter: string;
  targetFoodCostPercent: number; // e.g. 30 for 30%
  vatPercent: number; // e.g. 7
  serviceChargePercent: number; // e.g. 10
  dailyClosingTime: string; // "04:00" or "00:00"
  qrImageId?: string;
  pointsEarnUnitThb: number; // e.g. spend 100 THB get 1 point
  pointsRedeemValueThb: number; // e.g. 1 point = 1 THB discount
  // USALI-style Accounting & Costing Standards
  pricesIncludeVat?: boolean; // Menu prices already include VAT (default false)
  serviceChargeIncludedInPrice?: boolean; // Menu prices include service charge (default false)
  serviceChargeTreatment?: 'staff_pool' | 'retained'; // 'staff_pool' = pass-through, 'retained' = other revenue
  commissionBase?: 'net_food_sales'; // Commission base (default 'net_food_sales')
  commissionVatAsCost?: boolean; // If true, add 7% VAT on platform commission as a cost
  priceRounding?: 1 | 5 | 10; // Suggested price rounding (default 5 THB)
  operatingDaysPerMonth?: number; // Number of operating days for daily break-even (default 30)
}

export interface IngredientDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  purchaseUnit: string; // 'kg', 'g', 'l', 'ml', 'piece', 'pack'
  purchasePrice: number; // Price per purchase pack/unit
  purchaseQuantity: number; // Quantity in purchase pack (e.g. 5 for 5kg)
  yieldPercent: number; // e.g. 85 for 85% yield after trimming
  baseUnit: 'g' | 'ml' | 'piece'; // Normalized unit
  costPerBaseUnit: number; // Automatic cost per g / ml / piece
  costMethod?: 'latest' | 'average'; // 'latest' = current price, 'average' = avg of last 3 priceHistory
  priceHistory?: { date: string; price: number; yieldPercent: number }[];
}

export interface RecipeIngredientItem {
  ingredientId: string;
  quantity: number; // In base unit of ingredient (g, ml, piece)
}

export interface RecipeSubRecipeItem {
  subRecipeId: string;
  quantity: number; // In output unit of subRecipe
}

export interface RecipePackagingItem {
  packagingId: string;
  quantity: number;
}

export interface SubRecipeDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  outputUnit: string; // 'portion', 'g', 'ml', 'cup'
  outputQuantity: number; // Total output yield from this batch
  ingredients: RecipeIngredientItem[];
  subRecipes?: RecipeSubRecipeItem[]; // nested sub-recipes if any
}

export interface PackagingDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  cost: number;
  unit: string;
}

export interface OptionChoice {
  id: string;
  name: string;
  nameTh?: string;
  price: number; // Additional price
  ingredients?: RecipeIngredientItem[]; // Cost lines for choice
}

export interface OptionGroupDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  minSelect: number;
  maxSelect: number;
  order: number;
  choices: OptionChoice[];
}

export interface DishVariant {
  id: string;
  name: string;
  nameTh?: string;
  price: number;
  ingredients: RecipeIngredientItem[];
  subRecipes: RecipeSubRecipeItem[];
  packaging: RecipePackagingItem[];
}

export interface DishDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  categoryId: string;
  imageId?: string;
  description?: string;
  variants: DishVariant[]; // At least 1 default variant
  optionGroupIds: string[]; // Attached option groups
  order: number;
}

export interface CategoryDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  order: number;
}

export interface ChannelDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  type: OrderType;
  commissionPercent: number; // e.g. 30% for delivery platforms
  packagingCost: number; // default packaging cost for channel
  priceMarkupPercent?: number; // e.g. 15 for 15% price markup on channel (default 0)
}

export interface TableDoc extends BaseDoc {
  name: string;
  zoneId: string;
  shape: TableShape;
  chairs: number;
  x: number; // px coordinate in floor plan
  y: number; // px coordinate in floor plan
  currentBillId?: string | null;
}

export interface ZoneDoc extends BaseDoc {
  name: string;
  nameTh?: string;
  order: number;
}

export interface OrderItemOption {
  groupId: string;
  groupName: string;
  choiceId: string;
  choiceName: string;
  price: number; // Price snapshot
  cost: number; // Cost snapshot
}

export interface OrderItem {
  dishId: string;
  dishName: string;
  variantId: string;
  variantName: string;
  unitPrice: number; // Snapshot of variant price (with channel markup if applicable) + options
  dishCostSnapshot: number; // Snapshot of dish cost
  optionsCostSnapshot: number; // Snapshot of options cost
  foodCostSnapshot?: number; // Snapshot of Food COGS only (ingredients + sub-recipes + options)
  packagingCostSnapshot?: number; // Snapshot of packaging only (variant packaging for takeaway/delivery)
  totalUnitCostSnapshot: number; // Food cost + packaging cost snapshot (backward compatibility)
  quantity: number;
  notes?: string;
  options: OrderItemOption[];
  hasRecipe: boolean;
}

export interface PaymentSplit {
  method: PaymentMethod;
  amount: number;
  tendered?: number; // Cash tendered
  change?: number; // Cash change
}

export interface BillDoc extends BaseDoc {
  billNumber: string; // e.g. "B-20261112-0001"
  status: BillStatus;
  workDate: string; // YYYY-MM-DD following daily closing time
  tableId?: string | null;
  tableName?: string;
  channelId: string;
  channelName: string;
  orderType: OrderType;
  items: OrderItem[];
  
  // Financial snapshots
  subtotal: number;
  discountAmount: number;
  memberId?: string | null;
  memberName?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  serviceChargeRate: number;
  serviceChargeAmount: number;
  vatRate: number;
  vatAmount: number;
  grandTotal: number;
  netSales: number; // grandTotal - vat - serviceCharge (or subtotal - discount)
  totalFoodCost: number; // Snapshot of food cost for all items
  packagingCost: number;
  platformFee: number;
  
  payments: PaymentSplit[];
  paidAt?: string;
  voidReason?: string;
  voidedAt?: string;
}

export interface ExpenseDoc extends BaseDoc {
  title: string;
  titleTh?: string;
  category: 'rent' | 'electricity' | 'water' | 'gas' | 'marketing' | 'repairs' | 'supplies' | 'other';
  amount: number;
  date: string; // YYYY-MM-DD
  isFixed: boolean; // Fixed vs Variable
  isRecurring: boolean; // Monthly recurring
}

export interface EmployeeDoc extends BaseDoc {
  name: string;
  role: string;
  wageType: WageType;
  wageAmount: number; // e.g. 15,000 / month or 450 / day or 60 / hour
  workDaysOrHoursPerMonth?: number; // Estimated days or hours for hourly/daily
  phone?: string;
  isActive: boolean;
}

export interface ShiftDoc extends BaseDoc {
  openedAt: string;
  closedAt?: string;
  startingCash: number;
  expectedCash?: number;
  countedCash?: number;
  discrepancy?: number;
  notes?: string;
  status: 'open' | 'closed';
  workDate: string;
}

export interface MemberDoc extends BaseDoc {
  name: string;
  phone: string;
  points: number;
  totalSpent: number;
  visitCount: number;
}

export interface ImageDoc extends BaseDoc {
  dataUrl: string; // Base64 data URL
  sizeBytes: number;
}

export interface DailySummaryDishStat {
  dishId: string;
  dishName: string;
  quantity: number;
  revenue: number;
  cost: number;
}

export interface DailySummaryDoc extends BaseDoc {
  date: string; // YYYY-MM-DD (matches daily closing time cycle)
  orderCount: number;
  grossSales: number; // subtotal
  discounts: number;
  netSales: number;
  serviceCharge: number;
  vat: number;
  totalFoodCost: number;
  packagingCost: number;
  platformFees: number;
  paymentTotals: Record<PaymentMethod, number>;
  channelTotals: Record<string, { orderCount: number; netSales: number }>;
  dishStats: Record<string, DailySummaryDishStat>;
}

export interface CounterDoc extends BaseDoc {
  count: number;
  workDate: string;
}
