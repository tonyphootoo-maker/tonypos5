import { describe, expect, it } from 'vitest';
import {
  buildExternalGoogleMapsUrl,
  buildWebSyncDailySalesRecords,
  calculateOnlineOrderCostSnapshot,
  extractLatLngLiteral,
  formatNavDistance,
  formatNavDuration,
  getBangkokBusinessWorkDate,
  haversineMeters,
  isOnlineOrderInLocalPeriod,
  resolveAppMode,
  sanitizeMenuForPublicStore,
  stripHtmlInstructions,
} from '../onlineOrdering';
import { buildPeriodPnl } from '../calculations';
import { convertDailySummariesToSalesRecords } from '../../costing/services/firebaseSyncService';
import {
  CategoryDoc,
  DailySummaryDoc,
  DishDoc,
  IngredientDoc,
  OnlineOrderDoc,
  OptionGroupDoc,
  PackagingDoc,
  SettingsDoc,
  SubRecipeDoc,
} from '../../types';

const nowIso = '2026-11-18T05:00:00.000Z';

const mockSettings: SettingsDoc = {
  id: 'main',
  shopName: 'KinPOS Kitchen',
  shopAddress: '123 Sukhumvit, Bangkok',
  shopPhone: '02-999-8888',
  taxId: '0105558000000',
  receiptHeader: 'Welcome',
  receiptFooter: 'Thank you',
  targetFoodCostPercent: 30,
  vatPercent: 7,
  serviceChargePercent: 10,
  dailyClosingTime: '04:00',
  qrImageId: 'qr_promptpay_1',
  pointsEarnUnitThb: 100,
  pointsRedeemValueThb: 1,
  pricesIncludeVat: false,
  onlineOrderingEnabled: true,
  onlineDeliveryFee: 35,
  onlinePickupEnabled: true,
  onlineDeliveryEnabled: true,
  onlineEstimatedPrepMinutes: 20,
  createdAt: nowIso,
  updatedAt: nowIso,
  version: 1,
};

const mockIngredients: IngredientDoc[] = [
  {
    id: 'ing_pork',
    name: 'Minced Pork',
    purchaseUnit: 'kg',
    purchasePrice: 160,
    purchaseQuantity: 1,
    yieldPercent: 100,
    baseUnit: 'g',
    costPerBaseUnit: 0.16, // 0.16 THB per gram
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  },
  {
    id: 'ing_egg',
    name: 'Egg',
    purchaseUnit: 'piece',
    purchasePrice: 5,
    purchaseQuantity: 1,
    yieldPercent: 100,
    baseUnit: 'piece',
    costPerBaseUnit: 5,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  },
];

const mockPackaging: PackagingDoc[] = [
  {
    id: 'pkg_box',
    name: 'Food Box',
    cost: 4,
    unit: 'piece',
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  },
];

const mockOptionGroups: OptionGroupDoc[] = [
  {
    id: 'grp_addon',
    name: 'Add-on',
    nameTh: 'เพิ่มเติม',
    minSelect: 0,
    maxSelect: 2,
    order: 1,
    choices: [
      {
        id: 'ch_egg',
        name: 'Fried Egg',
        nameTh: 'ไข่ดาว',
        price: 15,
        ingredients: [{ ingredientId: 'ing_egg', quantity: 1 }],
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  },
];

const mockCategories: CategoryDoc[] = [
  {
    id: 'cat_main',
    name: 'Main Dishes',
    nameTh: 'อาหารจานหลัก',
    order: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  },
];

const mockDishes: DishDoc[] = [
  {
    id: 'dish_kaprao',
    name: 'Pad Kaprao',
    nameTh: 'กะเพราหมูสับ',
    categoryId: 'cat_main',
    imageId: 'img_kaprao',
    description: 'Classic Thai basil stir fry',
    costMenuId: 'secret_cost_menu_1',
    optionGroupIds: ['grp_addon'],
    order: 1,
    variants: [
      {
        id: 'var_reg',
        name: 'Regular',
        nameTh: 'ธรรมดา',
        price: 80,
        costMenuId: 'secret_cost_menu_1',
        costVariantId: 'secret_var_1',
        ingredients: [{ ingredientId: 'ing_pork', quantity: 150 }], // 24 THB
        subRecipes: [],
        packaging: [{ packagingId: 'pkg_box', quantity: 1 }], // 4 THB
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  },
];

describe('Online Ordering Engine', () => {
  it('resolves role-based entry modes from URL query params and pathnames', () => {
    expect(resolveAppMode('?mode=order&store=abc', '/')).toBe('customer');
    expect(resolveAppMode('?mode=customer', '/')).toBe('customer');
    expect(resolveAppMode('', '/order')).toBe('customer');
    expect(resolveAppMode('', '/tonypos5/order/')).toBe('customer');
    expect(resolveAppMode('?mode=rider&store=abc', '/')).toBe('rider');
    expect(resolveAppMode('', '/rider')).toBe('rider');
    expect(resolveAppMode('', '/')).toBe('owner');
    expect(resolveAppMode('?tab=pos', '/')).toBe('owner');
  });

  it('sanitizes public storefront menu with zero cost/recipe leakage', () => {
    const { publicStore, referencedImageIds } = sanitizeMenuForPublicStore({
      storeId: 'owner_uid_123',
      settings: mockSettings,
      categories: mockCategories,
      dishes: mockDishes,
      optionGroups: mockOptionGroups,
      publishedAt: nowIso,
    });

    const json = JSON.stringify(publicStore);
    expect(json).not.toContain('ingredients');
    expect(json).not.toContain('subRecipes');
    expect(json).not.toContain('packaging');
    expect(json).not.toContain('costMenuId');
    expect(json).not.toContain('costVariantId');
    expect(json).not.toContain('costPerBaseUnit');
    expect(publicStore.dishes[0].variants[0].price).toBe(80);
    expect(publicStore.optionGroups[0].choices[0].price).toBe(15);
    expect(referencedImageIds).toContain('img_kaprao');
    expect(referencedImageIds).toContain('qr_promptpay_1');
  });

  it('computes business workDate strictly in Asia/Bangkok respecting dailyClosingTime', () => {
    // 2026-11-18T18:30:00Z = 2026-11-19 01:30 Bangkok (< 04:00 closing -> shifts back to 2026-11-18)
    expect(getBangkokBusinessWorkDate('2026-11-18T18:30:00.000Z', '04:00')).toBe('2026-11-18');
    // 2026-11-18T22:00:00Z = 2026-11-19 05:00 Bangkok (>= 04:00 closing -> stays 2026-11-19)
    expect(getBangkokBusinessWorkDate('2026-11-18T22:00:00.000Z', '04:00')).toBe('2026-11-19');
  });

  it('filters online orders by Thailand local calendar periods', () => {
    // Ref: 2026-11-18 12:00 Bangkok (Wednesday)
    const ref = new Date('2026-11-18T05:00:00.000Z');
    const sameDay = '2026-11-18T15:00:00.000Z'; // 22:00 BKK same day
    const sameWeekMon = '2026-11-16T03:00:00.000Z'; // Monday 10:00 BKK
    const prevMonth = '2026-10-25T05:00:00.000Z';

    expect(isOnlineOrderInLocalPeriod(sameDay, 'today', ref)).toBe(true);
    expect(isOnlineOrderInLocalPeriod(sameWeekMon, 'today', ref)).toBe(false);
    expect(isOnlineOrderInLocalPeriod(sameWeekMon, 'week', ref)).toBe(true);
    expect(isOnlineOrderInLocalPeriod(prevMonth, 'month', ref)).toBe(false);
    expect(isOnlineOrderInLocalPeriod(prevMonth, 'year', ref)).toBe(true);
    expect(isOnlineOrderInLocalPeriod(prevMonth, 'all', ref)).toBe(true);
  });

  it('calculates real food & packaging cost snapshots for dish variants + option ingredients', () => {
    const res = calculateOnlineOrderCostSnapshot({
      items: [
        {
          dishId: 'dish_kaprao',
          dishName: 'Pad Kaprao',
          variantId: 'var_reg',
          variantName: 'Regular',
          unitPrice: 95,
          quantity: 2,
          options: [
            {
              groupId: 'grp_addon',
              groupName: 'Add-on',
              choiceId: 'ch_egg',
              choiceName: 'Fried Egg',
              price: 15,
            },
          ],
        },
      ],
      dishesMap: new Map(mockDishes.map((d) => [d.id, d])),
      optionGroupsMap: new Map(mockOptionGroups.map((g) => [g.id, g])),
      ingredientsMap: new Map(mockIngredients.map((i) => [i.id, i])),
      subRecipesMap: new Map<string, SubRecipeDoc>(),
      packagingMap: new Map(mockPackaging.map((p) => [p.id, p])),
    });

    // Per item: 150g * 0.16 (24) + 1 egg (5) = 29 food; 4 packaging. Quantity 2 => 58 food, 8 packaging.
    expect(res.foodCost).toBe(58);
    expect(res.packagingCost).toBe(8);
  });

  it('builds web_sync_* DailySalesRecords only from completed orders, separating deliveryFee and splitting Cash/QR', () => {
    const orders: OnlineOrderDoc[] = [
      {
        id: 'ord_pending',
        orderNumber: 'ON-1',
        storeId: 'owner1',
        customerUid: 'c1',
        customerName: 'A',
        customerPhone: '0811111111',
        orderMode: 'pickup',
        paymentMethod: 'cash',
        items: [],
        subtotal: 999,
        deliveryFee: 0,
        totalAmount: 999,
        status: 'pending',
        createdAt: '2026-11-18T05:00:00.000Z',
      },
      {
        id: 'ord_cancelled',
        orderNumber: 'ON-2',
        storeId: 'owner1',
        customerUid: 'c2',
        customerName: 'B',
        customerPhone: '0822222222',
        orderMode: 'delivery',
        paymentMethod: 'qr_payment',
        items: [],
        subtotal: 500,
        deliveryFee: 35,
        totalAmount: 535,
        status: 'cancelled',
        createdAt: '2026-11-18T05:00:00.000Z',
      },
      {
        id: 'ord_done_delivery',
        orderNumber: 'ON-3',
        storeId: 'owner1',
        customerUid: 'c3',
        customerName: 'Somchai',
        customerPhone: '0833333333',
        orderMode: 'delivery',
        paymentMethod: 'qr_payment',
        deliveryAddress: '99 Rama 9',
        items: [
          {
            dishId: 'dish_kaprao',
            dishName: 'Pad Kaprao',
            variantId: 'var_reg',
            variantName: 'Regular',
            unitPrice: 95,
            quantity: 2,
            options: [
              {
                groupId: 'grp_addon',
                groupName: 'Add-on',
                choiceId: 'ch_egg',
                choiceName: 'Fried Egg',
                price: 15,
              },
            ],
          },
        ],
        subtotal: 190,
        deliveryFee: 35,
        totalAmount: 225,
        status: 'completed',
        createdAt: '2026-11-18T05:00:00.000Z',
        completedAt: '2026-11-18T05:45:00.000Z',
      },
    ];

    const records = buildWebSyncDailySalesRecords(orders, {
      dailyClosingTime: '04:00',
      pricesIncludeVat: false,
      vatPercent: 7,
      dishes: mockDishes,
      optionGroups: mockOptionGroups,
      ingredients: mockIngredients,
      subRecipes: [],
      packaging: mockPackaging,
    });

    const keys = Object.keys(records);
    expect(keys).toEqual(['web_sync_2026-11-18_web_delivery']);
    const rec = records['web_sync_2026-11-18_web_delivery'];
    expect(rec.netSales).toBe(190); // Food sales only, NOT 225!
    expect(rec.grossSales).toBe(190);
    expect(rec.deliveryFeeTotal).toBe(35);
    expect(rec.qrSalesTotal).toBe(225);
    expect(rec.cashSalesTotal).toBe(0);
    expect(rec.foodCost).toBe(58);
    expect(rec.packagingCost).toBe(8);
    expect(rec.orderCount).toBe(1);
  });

  it('always sums web_sync_* into buildPeriodPnl without POS collision or posWholeDateCovered skipping', () => {
    const posSummaryWholeDate: DailySummaryDoc = {
      id: '2026-11-18',
      date: '2026-11-18',
      orderCount: 5,
      grossSales: 1000,
      discounts: 0,
      netSales: 1000,
      serviceCharge: 0,
      vat: 70,
      totalFoodCost: 300,
      packagingCost: 10,
      platformFees: 0,
      paymentTotals: { cash: 1000, qr: 0, card: 0, transfer: 0 },
      channelTotals: {}, // Triggers posWholeDateCovered!
      dishStats: {},
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };

    const webRecords = buildWebSyncDailySalesRecords(
      [
        {
          id: 'ord_done_pickup',
          orderNumber: 'ON-99',
          storeId: 'owner1',
          customerUid: 'c9',
          customerName: 'Nok',
          customerPhone: '0899999999',
          orderMode: 'pickup',
          paymentMethod: 'cash',
          items: [
            {
              dishId: 'dish_kaprao',
              dishName: 'Pad Kaprao',
              variantId: 'var_reg',
              variantName: 'Regular',
              unitPrice: 80,
              quantity: 5,
              options: [],
            },
          ],
          subtotal: 400,
          deliveryFee: 0,
          totalAmount: 400,
          status: 'completed',
          createdAt: '2026-11-18T06:00:00.000Z',
          completedAt: '2026-11-18T06:30:00.000Z',
        },
      ],
      {
        dailyClosingTime: '04:00',
        pricesIncludeVat: false,
        vatPercent: 7,
        dishes: mockDishes,
        optionGroups: mockOptionGroups,
        ingredients: mockIngredients,
        subRecipes: [],
        packaging: mockPackaging,
      }
    );

    const existingList = Object.values(webRecords);
    const mergedAfterPosPull = convertDailySummariesToSalesRecords(
      [posSummaryWholeDate],
      existingList
    );

    // Ensure pullDailySales preserved web_sync_* alongside pos_sync_*
    expect(mergedAfterPosPull.some((r) => r.id === 'web_sync_2026-11-18_web_pickup')).toBe(true);
    expect(mergedAfterPosPull.some((r) => r.id === 'pos_sync_2026-11-18_dine_in')).toBe(true);

    // Ensure buildPeriodPnl includes both 1,000 POS dine-in + 400 Web pickup = 1,400 total
    const pnl = buildPeriodPnl({
      summaries: [posSummaryWholeDate],
      manualSales: existingList,
      expenses: [],
      employees: [],
      period: 'day',
      dateParam: '2026-11-18',
      settings: mockSettings,
      cogsMode: 'estimated',
      todayDate: '2026-11-18',
    });

    expect(pnl.netSalesExVat).toBe(1400);
    expect(pnl.orderCount).toBe(6);
    // POS food cost (300) + Web pickup food cost (5 * 24 = 120) = 420
    expect(pnl.foodCogs).toBe(420);
    // POS packaging (10) + Web pickup packaging (5 * 4 = 20) = 30
    expect(pnl.packagingCogs).toBe(30);
    expect(pnl.grossProfit).toBe(1400 - 420 - 30);
    expect(pnl.operatingProfit).toBe(950);
    expect(pnl.netProfit).toBe(950 - pnl.estimatedTax);
  });

  it('generates and persists high-entropy guest UID and tracked order IDs without blocking on Anonymous Auth', async () => {
    const storeMap = new Map<string, string>();
    const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeMap.set(k, v);
      },
      removeItem: (k: string) => {
        storeMap.delete(k);
      },
      clear: () => storeMap.clear(),
      key: (i: number) => Array.from(storeMap.keys())[i] ?? null,
      get length() {
        return storeMap.size;
      },
    };

    try {
      const {
        getOrCreateGuestUid,
        loadTrackedCustomerOrderIds,
        resolveCustomerOrRiderSession,
        saveTrackedCustomerOrderId,
      } = await import('../../data/onlineDb');

      const uid1 = getOrCreateGuestUid();
      const uid2 = getOrCreateGuestUid();
      expect(uid1).toMatch(/^guest_[a-zA-Z0-9_-]{24}$/);
      expect(uid2).toBe(uid1);

      const saved1 = saveTrackedCustomerOrderId('ord_1795000000000_AbCdEfGh12345678', 'store_1');
      const saved2 = saveTrackedCustomerOrderId('ord_1795000001000_ZyXwVuTs87654321', 'store_1');
      expect(saved1).toEqual(['ord_1795000000000_AbCdEfGh12345678']);
      expect(saved2).toEqual([
        'ord_1795000001000_ZyXwVuTs87654321',
        'ord_1795000000000_AbCdEfGh12345678',
      ]);
      expect(loadTrackedCustomerOrderIds('store_1')).toEqual(saved2);

      const session = await resolveCustomerOrRiderSession();
      expect(session.uid).toMatch(/^guest_[a-zA-Z0-9_-]{24}$/);
      expect(session.isAuthenticated).toBe(false);
    } finally {
      if (prevLocalStorage) {
        (globalThis as { localStorage: Storage }).localStorage = prevLocalStorage;
      } else {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      }
    }
  });

  it('formats Rider navigation distances, durations, instructions, coordinates, and fallback Maps URLs', () => {
    // Haversine ~111.19 km per 1 degree latitude
    const dist = haversineMeters({ lat: 13.7563, lng: 100.5018 }, { lat: 13.7653, lng: 100.5018 });
    expect(dist).toBeGreaterThan(950);
    expect(dist).toBeLessThan(1050);

    expect(formatNavDistance(346, 'th')).toBe('350 ม.');
    expect(formatNavDistance(2450, 'th')).toBe('2.5 กม.');
    expect(formatNavDistance(2450, 'en')).toBe('2.5 km');

    expect(formatNavDuration(12 * 60000, 'th')).toBe('12 นาที');
    expect(formatNavDuration(75 * 60000, 'th')).toBe('1 ชม. 15 นาที');
    expect(formatNavDuration(60 * 60000, 'en')).toBe('1 hr');

    expect(
      stripHtmlInstructions('Turn <b>left</b> onto Sukhumvit Rd<div style="font-size:0.9em">Pass BTS</div>')
    ).toBe('Turn left onto Sukhumvit Rd Pass BTS');

    expect(extractLatLngLiteral({ lat: 13.75, lng: 100.5 })).toEqual({ lat: 13.75, lng: 100.5 });
    expect(extractLatLngLiteral({ lat: () => 13.8, lng: () => 100.6 })).toEqual({ lat: 13.8, lng: 100.6 });
    expect(
      extractLatLngLiteral({ location: { latLng: { latitude: 13.71, longitude: 100.52 } } })
    ).toEqual({ lat: 13.71, lng: 100.52 });
    expect(extractLatLngLiteral(null)).toBeNull();

    expect(
      buildExternalGoogleMapsUrl({
        deliveryLat: 13.7563,
        deliveryLng: 100.5018,
        deliveryAddress: 'Siam',
      })
    ).toBe('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=13.7563,100.5018');

    expect(
      buildExternalGoogleMapsUrl({
        deliveryAddress: '99 Rama 9 Bangkok',
      })
    ).toBe('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=99%20Rama%209%20Bangkok');
  });
});


