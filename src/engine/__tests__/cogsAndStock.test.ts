import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPeriodPnl,
  resolveStockCountSnapshotsForPeriod,
  filterPeriodPurchases,
  filterPeriodWaste,
} from '../calculations';
import {
  calculateInventoryCOGS,
  calculateVariance,
} from '../../costing/engine/calculations';
import {
  explodeRecipeItems,
  TransactionService,
} from '../../costing/services/transactionService';
import { StorageService } from '../../costing/services/storageService';
import { resolveInventoryApUnitCost } from '../../costing/components/InventoryView';
import { DailySummaryDoc } from '../../types';
import {
  StockCountSnapshot,
  PurchaseRecord,
  WasteRecord,
  Ingredient,
  InventoryItem,
  InventoryTransaction,
  MenuItem,
  SaleOrder,
} from '../../costing/types';
import { DailySalesRecord } from '../../costing/types/domain';

const baseTimestamps = {
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  version: 1,
};

function makeSummary(overrides: Partial<DailySummaryDoc> = {}): DailySummaryDoc {
  return {
    id: 'sum-1',
    date: '2026-03-15',
    orderCount: 50,
    grossSales: 107000,
    discounts: 0,
    netSales: 100000,
    serviceCharge: 0,
    vat: 7000,
    totalFoodCost: 30000,
    packagingCost: 0,
    platformFees: 0,
    paymentTotals: { cash: 100000, qr: 0, card: 0, transfer: 0 },
    channelTotals: { dine_in: { orderCount: 50, netSales: 100000 } },
    dishStats: {},
    ...baseTimestamps,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<StockCountSnapshot> = {}): StockCountSnapshot {
  return {
    id: 'snap-1',
    date: '2026-02-28',
    totalValue: 50000,
    items: [],
    createdAt: '2026-02-28T23:59:00.000Z',
    ...overrides,
  };
}

function makePurchase(overrides: Partial<PurchaseRecord> = {}): PurchaseRecord {
  return {
    id: 'pur-1',
    date: '2026-03-10',
    supplierName: 'Makro',
    ingredientId: 'ing-1',
    ingredientName: 'Chicken Breast',
    quantity: 10,
    unit: 'kg',
    price: 1000,
    totalPrice: 1000,
    ...overrides,
  };
}

function makeWaste(overrides: Partial<WasteRecord> = {}): WasteRecord {
  return {
    id: 'waste-1',
    date: '2026-03-12',
    ingredientId: 'ing-1',
    ingredientName: 'Chicken Breast',
    quantity: 5,
    unit: 'kg',
    cost: 500,
    totalCost: 500,
    reason: 'Expired',
    user: 'Chef',
    ...overrides,
  };
}

describe('Food Cost, Inventory COGS & BOM AP Stock Deduction (Instruction Set 2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Scenario 1 & 2: COGS = Beginning + Purchases - Ending (Waste never subtracted) & % of Net Sales variance threshold
  it('computes COGS = Begin + Purchases - Ending, keeps Waste in wasteMemo only, and evaluates Variance by % of Net Sales', () => {
    const result = calculateInventoryCOGS(50000, 30000, 48000, 5000);
    expect(result.cogs).toBe(32000);
    expect(Number(result)).toBe(32000);
    expect(result.wasteMemo).toBe(5000);
    expect(result.isNegative).toBe(false);

    // Variance = +2,000; Variance % of Theoretical = +6.67%; Net Sales = 100,000 => 2.00% <= 3% threshold => ON_TRACK
    const varUnderThreshold = calculateVariance(32000, 30000, 100000, 3);
    expect(varUnderThreshold.varianceAmount).toBe(2000);
    expect(varUnderThreshold.variancePercent).toBe(6.67);
    expect(varUnderThreshold.variancePercentOfSales).toBe(2);
    expect(varUnderThreshold.varianceStatus).toBe('ON_TRACK');

    // Same +2,000 variance on smaller Net Sales = 50,000 => 4.00% > 3% threshold => OVER_BUDGET
    const varOverThreshold = calculateVariance(32000, 30000, 50000, 3);
    expect(varOverThreshold.varianceAmount).toBe(2000);
    expect(varOverThreshold.variancePercent).toBe(6.67);
    expect(varOverThreshold.variancePercentOfSales).toBe(4);
    expect(varOverThreshold.varianceStatus).toBe('OVER_BUDGET');

    // Verify inside buildPeriodPnl: waste = 5,000 does NOT reduce foodCogs (32,000)
    const pnl = buildPeriodPnl({
      summaries: [makeSummary({ netSales: 100000, totalFoodCost: 30000 })],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: { cogsVarianceThresholdPercent: 3 },
      cogsMode: 'actual',
      todayDate: '2026-04-01',
      stockCountSnapshots: [
        makeSnapshot({ id: 'snap-begin', date: '2026-02-28', totalValue: 50000 }),
        makeSnapshot({ id: 'snap-end', date: '2026-03-31', totalValue: 48000 }),
      ],
      purchases: [makePurchase({ id: 'p-mar', date: '2026-03-10', totalPrice: 30000 })],
      wasteLog: [makeWaste({ id: 'w-mar', date: '2026-03-12', totalCost: 5000, cost: 5000 })],
    });

    expect(pnl.hasCompleteStockSnapshots).toBe(true);
    expect(pnl.cogsSource).toBe('actual');
    expect(pnl.actualFoodCogs).toBe(32000);
    expect(pnl.foodCogs).toBe(32000);
    expect(pnl.theoreticalFoodCogs).toBe(30000);
    expect(pnl.wasteMemo).toBe(5000);
    expect(pnl.varianceAmount).toBe(2000);
    expect(pnl.variancePercent).toBe(6.67);
    expect(pnl.variancePercentOfSales).toBe(2);
    expect(pnl.varianceStatus).toBe('ON_TRACK');
  });

  // Scenario 3: Date filtering for purchases & wasteLog + excluding packaging purchases from food COGS
  it('filters purchases & wasteLog strictly to [periodStart, periodEnd] and excludes packaging from food purchases', () => {
    const ingredients: Array<Pick<Ingredient, 'id' | 'category'>> = [
      { id: 'ing-meat', category: 'เนื้อสัตว์และอาหารทะเล' },
      { id: 'ing-box', category: 'บรรจุภัณฑ์' },
    ];

    const purchases: PurchaseRecord[] = [
      makePurchase({ id: 'p-feb', date: '2026-02-28', ingredientId: 'ing-meat', totalPrice: 9999 }),
      makePurchase({ id: 'p-mar-1', date: '2026-03-01', ingredientId: 'ing-meat', totalPrice: 15000 }),
      makePurchase({ id: 'p-mar-2', date: '2026-03-31', ingredientId: 'ing-meat', totalPrice: 15000 }),
      makePurchase({
        id: 'p-mar-pkg-flag',
        date: '2026-03-15',
        ingredientId: 'ing-other',
        isPackaging: true,
        totalPrice: 4000,
      }),
      makePurchase({
        id: 'p-mar-pkg-cat-en',
        date: '2026-03-16',
        ingredientId: 'ing-other2',
        category: 'Packaging',
        totalPrice: 2000,
      }),
      makePurchase({
        id: 'p-mar-pkg-ing',
        date: '2026-03-17',
        ingredientId: 'ing-box',
        totalPrice: 1500,
      }),
      makePurchase({ id: 'p-apr', date: '2026-04-01', ingredientId: 'ing-meat', totalPrice: 8888 }),
    ];

    const wasteLog: WasteRecord[] = [
      makeWaste({ id: 'w-feb', date: '2026-02-28', totalCost: 900, cost: 900 }),
      makeWaste({ id: 'w-mar', date: '2026-03-20', totalCost: 1200, cost: 1200 }),
      makeWaste({ id: 'w-apr', date: '2026-04-01', totalCost: 700, cost: 700 }),
    ];

    const purchaseRes = filterPeriodPurchases(purchases, '2026-03-01', '2026-03-31', ingredients);
    expect(purchaseRes.totalFoodPurchases).toBe(30000);
    expect(purchaseRes.totalPackagingPurchases).toBe(7500);
    expect(purchaseRes.foodPurchases.map((p) => p.id)).toEqual(['p-mar-1', 'p-mar-2']);

    const wasteRes = filterPeriodWaste(wasteLog, '2026-03-01', '2026-03-31');
    expect(wasteRes.totalWasteCost).toBe(1200);
    expect(wasteRes.periodWaste.map((w) => w.id)).toEqual(['w-mar']);

    const pnl = buildPeriodPnl({
      summaries: [makeSummary({ netSales: 100000, totalFoodCost: 31000, packagingCost: 2000 })],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: {},
      cogsMode: 'actual',
      todayDate: '2026-04-05',
      stockCountSnapshots: [
        makeSnapshot({ id: 's-b', date: '2026-02-28', totalValue: 50000 }),
        makeSnapshot({ id: 's-e', date: '2026-03-31', totalValue: 48000 }),
      ],
      purchases,
      wasteLog,
      ingredients,
    });

    expect(pnl.periodFoodPurchases).toBe(30000);
    expect(pnl.periodPackagingPurchasesExcluded).toBe(7500);
    expect(pnl.foodCogs).toBe(32000); // 50,000 + 30,000 - 48,000
    expect(pnl.wasteMemo).toBe(1200);
  });

  // Scenario 4: Snapshot selection rules, incomplete fallback label, no double-count summaries/salesOrders, uncosted manual sales warning
  it('enforces snapshot pairing rules, falls back to Theoretical POS COGS without double counting, and warns on uncosted manual sales', () => {
    const snapshots: StockCountSnapshot[] = [
      makeSnapshot({ id: 's-jan', date: '2026-01-31', totalValue: 40000 }),
      makeSnapshot({ id: 's-feb', date: '2026-02-28', totalValue: 50000 }),
      makeSnapshot({ id: 's-mid', date: '2026-03-15', totalValue: 49000 }), // mid-month -> neither begin (< 03-01) nor end (>= 03-31)
      makeSnapshot({ id: 's-mar', date: '2026-03-31', totalValue: 48000 }),
      makeSnapshot({ id: 's-future', date: '2026-04-10', totalValue: 45000 }), // future vs todayDate '2026-04-01'
    ];

    const paired = resolveStockCountSnapshotsForPeriod(
      snapshots,
      '2026-03-01',
      '2026-03-31',
      '2026-04-01'
    );
    expect(paired.hasCompletePair).toBe(true);
    expect(paired.beginningSnapshot?.id).toBe('s-feb');
    expect(paired.endingSnapshot?.id).toBe('s-mar');

    // If todayDate is before periodEnd (2026-03-20 < 2026-03-31), no valid ending snapshot exists yet
    const midMonth = resolveStockCountSnapshotsForPeriod(
      snapshots,
      '2026-03-01',
      '2026-03-31',
      '2026-03-20'
    );
    expect(midMonth.hasCompletePair).toBe(false);
    expect(midMonth.beginningSnapshot?.id).toBe('s-feb');
    expect(midMonth.endingSnapshot).toBeNull();

    // Incomplete snapshots + summaries + salesOrders (overlapping date vs uncovered date) + uncosted manual sales
    const coveredSummary = makeSummary({
      id: 'sum-mar-10',
      date: '2026-03-10',
      netSales: 80000,
      totalFoodCost: 24000,
      packagingCost: 500,
      channelTotals: { dine_in: { orderCount: 40, netSales: 80000 } },
    });

    const salesOrders: SaleOrder[] = [
      // Covered by summary on 2026-03-10 -> MUST NOT double count
      {
        id: 'ord-covered',
        orderNumber: 'SO-1',
        date: '2026-03-10',
        time: '12:00',
        channel: 'DINE_IN',
        orderStatus: 'COMPLETED',
        paymentStatus: 'PAID',
        items: [],
        grossSales: 80000,
        commissionFee: 0,
        totalFoodCost: 24000,
        packagingCost: 500,
        grossProfit: 55500,
        netRevenue: 80000,
        createdAt: '2026-03-10T12:00:00.000Z',
        updatedAt: '2026-03-10T12:00:00.000Z',
      },
      // Uncovered date 2026-03-11 -> SHOULD be included in theoretical COGS
      {
        id: 'ord-uncovered',
        orderNumber: 'SO-2',
        date: '2026-03-11',
        time: '12:00',
        channel: 'DINE_IN',
        orderStatus: 'COMPLETED',
        paymentStatus: 'PAID',
        items: [],
        grossSales: 20000,
        commissionFee: 0,
        totalFoodCost: 6000,
        packagingCost: 200,
        grossProfit: 13800,
        netRevenue: 20000,
        createdAt: '2026-03-11T12:00:00.000Z',
        updatedAt: '2026-03-11T12:00:00.000Z',
      },
      // Cancelled order on uncovered date -> MUST be ignored
      {
        id: 'ord-cancelled',
        orderNumber: 'SO-3',
        date: '2026-03-12',
        time: '12:00',
        channel: 'DINE_IN',
        orderStatus: 'CANCELLED',
        paymentStatus: 'VOID',
        items: [],
        grossSales: 5000,
        commissionFee: 0,
        totalFoodCost: 1500,
        packagingCost: 0,
        grossProfit: 3500,
        netRevenue: 5000,
        createdAt: '2026-03-12T12:00:00.000Z',
        updatedAt: '2026-03-12T12:00:00.000Z',
      },
    ];

    const uncostedManual: DailySalesRecord = {
      id: 'man-uncosted',
      date: '2026-03-14',
      channelId: 'grab',
      channelName: 'GrabFood',
      grossSales: 10000,
      discounts: 0,
      refunds: 0,
      netSales: 10000,
      orderCount: 10,
      platformFees: 0,
      actualPayout: 10000,
    };

    const pnl = buildPeriodPnl({
      summaries: [coveredSummary],
      manualSales: [uncostedManual],
      salesOrders,
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: {},
      cogsMode: 'actual',
      todayDate: '2026-03-20',
      stockCountSnapshots: snapshots, // ends 03-31 is after todayDate 03-20 -> incomplete pair
    });

    expect(pnl.hasCompleteStockSnapshots).toBe(false);
    expect(pnl.cogsSource).toBe('theoretical');
    expect(pnl.actualFoodCogs).toBeNull();
    expect(pnl.cogsLabel).toBe('ประมาณการจากสูตร ยังไม่มีการนับสต็อก');
    expect(pnl.theoreticalFoodCogs).toBe(30000); // 24,000 + 6,000 (not +24,000 again, not +1,500 cancelled)
    expect(pnl.foodCogs).toBe(30000);
    expect(pnl.packagingCogs).toBe(700); // 500 + 200
    expect(pnl.uncostedManualSalesAmount).toBe(10000);
    expect(pnl.uncostedManualSalesWarning).toBe(
      'มียอดขาย manual 10,000 บาทที่ไม่มีต้นทุนอาหารคู่ อาจทำให้กำไรสูงเกินจริง'
    );
    expect(pnl.cogsStatus).toBe('incomplete');
  });

  // Scenario 5: BOM AP stock deduction + EP food cost + AP snapshot reconciliation + invalid yield fallback
  it('deducts AP raw stock (EP / yield), keeps order totalFoodCost as EP * costPerBaseUnit, reconciles snapshot value, and warns on invalid yield', () => {
    // Chicken: purchase 1 kg = 100 THB (0.10 THB/g AP), yield 80% => usable 800 g => costPerBaseUnit = 0.125 THB/g EP
    const chicken: Ingredient = {
      id: 'ing-chicken',
      name: 'สะโพกไก่เลาะกระดูก',
      category: 'เนื้อสัตว์และอาหารทะเล',
      purchaseUnit: 'kg',
      purchaseQuantity: 1,
      purchasePrice: 100,
      actualQuantity: 800,
      actualUnit: 'g',
      yieldPercent: 80,
      baseUnit: 'g',
      usageUnit: 'g',
      actualCost: 125,
      costPerBaseUnit: 0.125,
      active: true,
      supplierName: 'Makro',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };

    const mysterySauceIng: Ingredient = {
      id: 'ing-sauce',
      name: 'ซอสสูตรลับ',
      category: 'เครื่องปรุงและซอส',
      purchaseUnit: 'g',
      purchaseQuantity: 1000,
      purchasePrice: 200,
      actualQuantity: 1000,
      actualUnit: 'g',
      yieldPercent: 0, // Invalid yield -> fallback to 100% + warning
      baseUnit: 'g',
      usageUnit: 'g',
      actualCost: 200,
      costPerBaseUnit: 0.2,
      active: true,
      supplierName: 'Makro',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };

    const menus: MenuItem[] = [
      {
        id: 'menu-1',
        name: 'ข้าวมันไก่',
        category: 'จานเดียว',
        active: true,
        variants: [
          {
            id: 'var-1',
            name: 'ปกติ',
            proteinType: 'ไก่',
            sellingPrice: 60,
            takeawayPrice: 60,
            deliveryPrice: 75,
            overheadCost: 0,
            directFoodCost: 10,
            packagingCost: 0,
            active: true,
            recipeItems: [
              {
                id: 'ri-1',
                ingredientId: 'ing-chicken',
                ingredientType: 'INGREDIENT',
                name: chicken.name,
                quantity: 80, // 80 g EP
                unit: 'g',
              },
            ],
          },
          {
            id: 'var-2',
            name: 'เพิ่มซอส',
            proteinType: 'ไก่',
            sellingPrice: 75,
            takeawayPrice: 75,
            deliveryPrice: 90,
            overheadCost: 0,
            directFoodCost: 10,
            packagingCost: 0,
            active: true,
            recipeItems: [
              {
                id: 'ri-2',
                ingredientId: 'ing-sauce',
                ingredientType: 'INGREDIENT',
                name: mysterySauceIng.name,
                quantity: 50,
                unit: 'g',
              },
            ],
          },
        ],
      },
    ];

    // Pure BOM explosion verification: 80 g EP / 0.80 = 100 g AP
    const exploded = explodeRecipeItems(
      [
        {
          menuId: 'menu-1',
          menuName: 'ข้าวมันไก่',
          variantId: 'var-1',
          variantName: 'ปกติ',
          quantity: 1,
          unitPrice: 60,
          totalPrice: 60,
          foodCostPerUnit: 10,
          totalFoodCost: 10,
        },
      ],
      menus,
      [],
      [chicken]
    );
    expect(exploded).toHaveLength(1);
    expect(exploded[0].epQuantity).toBe(80);
    expect(exploded[0].apQuantity).toBe(100);
    expect(exploded[0].quantity).toBe(100);
    expect(exploded[0].yieldPercent).toBe(80);
    expect(exploded[0].warning).toBeUndefined();

    // TransactionService full state verification with mocked StorageService
    let mockInventory: InventoryItem[] = [
      {
        id: 'inv-chicken',
        ingredientId: 'ing-chicken',
        ingredientName: chicken.name,
        category: chicken.category,
        currentStock: 1000, // 1,000 g AP
        currentQuantity: 1000,
        minStock: 200,
        unit: 'g',
        costPerUnit: 0.125,
        lastUpdated: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'inv-sauce',
        ingredientId: 'ing-sauce',
        ingredientName: mysterySauceIng.name,
        category: mysterySauceIng.category,
        currentStock: 500,
        currentQuantity: 500,
        minStock: 100,
        unit: 'g',
        costPerUnit: 0.2,
        lastUpdated: '2026-03-01T00:00:00.000Z',
      },
    ];
    let mockTxns: InventoryTransaction[] = [];
    let mockOrders: SaleOrder[] = [
      {
        id: 'order-chicken',
        orderNumber: 'ORD-100',
        date: '2026-03-15',
        time: '12:00',
        channel: 'DINE_IN',
        orderStatus: 'OPEN',
        paymentStatus: 'PENDING',
        items: [
          {
            menuId: 'menu-1',
            menuName: 'ข้าวมันไก่',
            variantId: 'var-1',
            variantName: 'ปกติ',
            quantity: 1,
            unitPrice: 60,
            totalPrice: 60,
            foodCostPerUnit: 0,
            totalFoodCost: 0,
          },
        ],
        grossSales: 60,
        netRevenue: 60,
        commissionFee: 0,
        totalFoodCost: 0, // force TransactionService to calculate from BOM
        packagingCost: 0,
        grossProfit: 60,
        createdAt: '2026-03-15T12:00:00.000Z',
        updatedAt: '2026-03-15T12:00:00.000Z',
      },
      {
        id: 'order-invalid-yield',
        orderNumber: 'ORD-101',
        date: '2026-03-15',
        time: '12:05',
        channel: 'DINE_IN',
        orderStatus: 'OPEN',
        paymentStatus: 'PENDING',
        items: [
          {
            menuId: 'menu-1',
            menuName: 'ข้าวมันไก่',
            variantId: 'var-2',
            variantName: 'เพิ่มซอส',
            quantity: 1,
            unitPrice: 75,
            totalPrice: 75,
            foodCostPerUnit: 0,
            totalFoodCost: 0,
          },
        ],
        grossSales: 75,
        netRevenue: 75,
        commissionFee: 0,
        totalFoodCost: 0,
        packagingCost: 0,
        grossProfit: 75,
        createdAt: '2026-03-15T12:05:00.000Z',
        updatedAt: '2026-03-15T12:05:00.000Z',
      },
    ];

    vi.spyOn(StorageService, 'getSalesOrders').mockImplementation(() => mockOrders);
    vi.spyOn(StorageService, 'saveSalesOrders').mockImplementation((next) => {
      mockOrders = next;
    });
    vi.spyOn(StorageService, 'getInventory').mockImplementation(() => mockInventory);
    vi.spyOn(StorageService, 'saveInventory').mockImplementation((next) => {
      mockInventory = next;
    });
    vi.spyOn(StorageService, 'getInventoryTransactions').mockImplementation(() => mockTxns);
    vi.spyOn(StorageService, 'saveInventoryTransactions').mockImplementation((next) => {
      mockTxns = next;
    });
    vi.spyOn(StorageService, 'getMenus').mockReturnValue(menus);
    vi.spyOn(StorageService, 'getSauces').mockReturnValue([]);
    vi.spyOn(StorageService, 'getIngredients').mockReturnValue([chicken, mysterySauceIng]);

    // Value before deduction at AP unit cost: 1,000 g * 0.10 THB/g = 100 THB
    const apUnitCost = resolveInventoryApUnitCost(mockInventory[0], chicken);
    expect(apUnitCost).toBeCloseTo(0.1, 6);
    const beginningStockValue = 1000 * apUnitCost; // 100 THB

    const chickenRes = TransactionService.processSaleTransaction('order-chicken');
    expect(chickenRes.success).toBe(true);
    expect(chickenRes.warnings).toBeUndefined();
    expect(chickenRes.consumedIngredients[0].consumedQuantity).toBe(100); // 100 g AP deducted
    expect(chickenRes.consumedIngredients[0].remainingStock).toBe(900); // 1,000 - 100 = 900 g AP
    expect(chickenRes.totalFoodCost).toBe(10); // 80 g EP * 0.125 = 10 THB (never divided by yield twice!)
    expect(mockInventory[0].currentStock).toBe(900);

    // Accounting reconciliation: Begin (100 THB) - End (900 g * 0.10 = 90 THB) === 10 THB === Theoretical COGS!
    const endingStockValue = mockInventory[0].currentStock * apUnitCost;
    const actualCogs = calculateInventoryCOGS(beginningStockValue, 0, endingStockValue, 0).cogs;
    expect(actualCogs).toBeCloseTo(chickenRes.totalFoodCost, 6);

    // Invalid yield (0) falls back to 100% and emits explicit warning
    const fallbackRes = TransactionService.processSaleTransaction('order-invalid-yield');
    expect(fallbackRes.success).toBe(true);
    expect(fallbackRes.consumedIngredients[0].consumedQuantity).toBe(50);
    expect(mockInventory[1].currentStock).toBe(450);
    expect(fallbackRes.warnings).toBeDefined();
    expect(fallbackRes.warnings?.length).toBeGreaterThan(0);
    expect(fallbackRes.warnings?.[0]).toContain('Yield');
  });
});
