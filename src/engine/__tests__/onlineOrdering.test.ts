import { describe, expect, it } from 'vitest';
import {
  buildExternalGoogleMapsUrl,
  buildOnlineOrderNumberingMap,
  buildWebSyncDailySalesRecords,
  calculateOnlineOrderCostSnapshot,
  canCustomerCancelOrder,
  extractLatLngLiteral,
  extractStoreIdFromLocation,
  formatCountdownMMSS,
  formatNavDistance,
  formatNavDuration,
  getActiveOnlineZoneOrders,
  getActiveRiderZoneOrders,
  getBangkokBusinessWorkDate,
  getCurrentPositionWithIosFallback,
  getPendingOnlineOrders,
  haversineMeters,
  isOnlineOrderInActiveZone,
  isOnlineOrderInLocalPeriod,
  isOnlineOrderInRiderZone,
  isOnlineOrderPendingAlert,
  latLngToMercatorPixel,
  matchesOnlineManagerStatusFilter,
  matchesOnlineOrderSearch,
  mercatorPixelToLatLng,
  ONLINE_CUSTOMER_CANCEL_WINDOW_MS,
  parseFirestoreRestDocument,
  resolveAppMode,
  resolveNextReadyActionStatus,
  sanitizeMenuForPublicStore,
  stripHtmlInstructions,
} from '../onlineOrdering';
import {
  deleteSavedCustomerAddress,
  deleteSavedCustomerFavoriteItem,
  loadCustomerFavoriteDishIds,
  loadSavedCustomerAddresses,
  loadSavedCustomerFavoriteItems,
  setDefaultCustomerAddress,
  toggleCustomerFavoriteDishId,
  upsertSavedCustomerAddress,
  upsertSavedCustomerFavoriteItem,
} from '../../data/onlineDb';
import { buildPeriodPnl } from '../calculations';
import { convertDailySummariesToSalesRecords } from '../../costing/services/firebaseSyncService';
import {
  resolveCostVariantDisplayNames,
  resolveCostVariantLabel,
} from '../../costing/services/spreadsheetCostHelper';
import {
  getLocalizedDishDescription,
  resolveBilingualDescriptionFields,
} from '../../utils/thaiToEnglish';
import type { MenuItem as CostMenuItem } from '../../costing/types';
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
    expect(resolveAppMode('?store=abc', '/rider.html')).toBe('rider');
    expect(resolveAppMode('', '/subpath/rider.html')).toBe('rider');
    expect(resolveAppMode('', '/', '#/?mode=order&store=abc')).toBe('customer');
    expect(resolveAppMode('', '/', '#mode=rider')).toBe('rider');
    expect(resolveAppMode('', '/')).toBe('owner');
    expect(resolveAppMode('?tab=pos', '/')).toBe('owner');
  });

  it('sanitizes public storefront menu with zero cost/recipe leakage and propagates optional logoImageId', () => {
    const { publicStore, referencedImageIds } = sanitizeMenuForPublicStore({
      storeId: 'owner_uid_123',
      settings: { ...mockSettings, logoImageId: 'logo_custom_1' },
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
    expect(publicStore.logoImageId).toBe('logo_custom_1');
    expect(referencedImageIds).toContain('img_kaprao');
    expect(referencedImageIds).toContain('qr_promptpay_1');
    expect(referencedImageIds).toContain('logo_custom_1');

    const { publicStore: defaultLogoStore, referencedImageIds: defaultImgIds } =
      sanitizeMenuForPublicStore({
        storeId: 'owner_uid_123',
        settings: { ...mockSettings, logoImageId: '' },
        categories: mockCategories,
        dishes: mockDishes,
        optionGroups: mockOptionGroups,
        publishedAt: nowIso,
      });
    expect(defaultLogoStore.logoImageId).toBeUndefined();
    expect(defaultImgIds).not.toContain('');
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
    ).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=13.7563,100.5018'
    );

    expect(
      buildExternalGoogleMapsUrl({
        deliveryAddress: '99 Rama 9 Bangkok',
      })
    ).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=99%20Rama%209%20Bangkok'
    );
  });

  it('resolves POS and Customer storefront option names from Food Cost item name (ชื่อรายการ) instead of proteinType', () => {
    const costMenu: CostMenuItem = {
      id: 'menu_kaprow',
      name: 'กะเพรา',
      thaiName: 'กะเพรา',
      englishName: 'Stir-Fried Holy Basil',
      category: 'ผัดและกะเพรา',
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      variants: [
        {
          id: 'var_kaprow_pork',
          menuId: 'menu_kaprow',
          name: 'กะเพราหมูสับ ราดข้าว',
          thaiName: 'กะเพราหมูสับ ราดข้าว',
          englishName: 'Stir-Fried Holy Basil with Minced Pork on Rice',
          proteinType: 'หมูสับ',
          sellingPrice: 69,
          takeawayPrice: 74,
          deliveryPrice: 104,
          overheadCost: 6,
          recipeItems: [],
          active: true,
        },
      ],
    };

    expect(resolveCostVariantLabel(costMenu.variants[0])).toBe('กะเพราหมูสับ ราดข้าว');

    const staleDish: DishDoc = {
      id: 'cost_dish_menu_kaprow',
      name: 'Stir-Fried Holy Basil',
      nameTh: 'กะเพรา',
      categoryId: 'cat_main',
      costMenuId: 'menu_kaprow',
      order: 1,
      optionGroupIds: [],
      variants: [
        {
          id: 'var_kaprow_pork',
          name: 'Minced Pork',
          nameTh: 'หมูสับ',
          price: 69,
          costMenuId: 'menu_kaprow',
          costVariantId: 'var_kaprow_pork',
          ingredients: [],
          subRecipes: [],
          packaging: [],
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };

    expect(resolveCostVariantDisplayNames(staleDish, staleDish.variants[0], [costMenu])).toEqual({
      name: 'Stir-Fried Holy Basil with Minced Pork on Rice',
      nameTh: 'กะเพราหมูสับ ราดข้าว',
    });

    const { publicStore } = sanitizeMenuForPublicStore({
      storeId: 'store_1',
      settings: mockSettings,
      categories: mockCategories,
      dishes: [staleDish],
      optionGroups: mockOptionGroups,
      costMenus: [costMenu],
      publishedAt: nowIso,
    });

    expect(publicStore.dishes[0].variants[0]).toEqual({
      id: 'var_kaprow_pork',
      name: 'Stir-Fried Holy Basil with Minced Pork on Rice',
      nameTh: 'กะเพราหมูสับ ราดข้าว',
      price: 69,
    });
  });

  it('extracts storeId from both query search and hash fragments', () => {
    expect(extractStoreIdFromLocation('?mode=order&store=uid_ios_123', '')).toBe('uid_ios_123');
    expect(extractStoreIdFromLocation('', '#/?mode=order&store=uid_hash_456')).toBe('uid_hash_456');
    expect(extractStoreIdFromLocation('', '#store=uid_hash_789')).toBe('uid_hash_789');
    expect(extractStoreIdFromLocation('?mode=order', '')).toBeNull();
  });

  it('decodes Firestore REST document payloads accurately for iOS fallback fetching', () => {
    const parsed = parseFirestoreRestDocument({
      name: 'projects/p/databases/(default)/documents/publicStores/store_abc',
      fields: {
        storeId: { stringValue: 'store_abc' },
        shopName: { stringValue: "Tony's Kit" },
        onlineOrderingEnabled: { booleanValue: true },
        onlineDeliveryFee: { integerValue: '25' },
        vatPercent: { doubleValue: 7.5 },
        optionalNull: { nullValue: null },
        categories: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    id: { stringValue: 'cat_1' },
                    name: { stringValue: 'Main' },
                    order: { integerValue: '1' },
                  },
                },
              },
            ],
          },
        },
        dishes: { arrayValue: {} },
      },
    });

    expect(parsed).toEqual({
      id: 'store_abc',
      storeId: 'store_abc',
      shopName: "Tony's Kit",
      onlineOrderingEnabled: true,
      onlineDeliveryFee: 25,
      vatPercent: 7.5,
      optionalNull: null,
      categories: [{ id: 'cat_1', name: 'Main', order: 1 }],
      dishes: [],
    });
    expect(parseFirestoreRestDocument(null)).toBeNull();
  });

  it('normalizes legacy Thai-only descriptions and preserves bilingual descriptions in publicStores', () => {
    const legacyThaiDish: DishDoc = {
      ...mockDishes[0],
      id: 'dish_legacy_desc',
      description: 'ผัดกะเพราแท้สูตรโบราณ รสเข้มจัดจ้าน ใช้ใบกะเพราสดและกระเทียมไทยแท้',
      descriptionTh: undefined,
    };
    const customBilingualDish: DishDoc = {
      ...mockDishes[0],
      id: 'dish_bilingual_desc',
      descriptionTh: 'เส้นจันท์ผัดซอสมะขามสูตรร้าน',
      description: 'Stir-fried Chanthaburi noodles with house tamarind sauce',
    };

    const { publicStore } = sanitizeMenuForPublicStore({
      storeId: 'store_1',
      settings: mockSettings,
      categories: mockCategories,
      dishes: [legacyThaiDish, customBilingualDish],
      optionGroups: mockOptionGroups,
      publishedAt: nowIso,
    });

    const legacyPub = publicStore.dishes.find((d) => d.id === 'dish_legacy_desc')!;
    const bilingualPub = publicStore.dishes.find((d) => d.id === 'dish_bilingual_desc')!;

    expect(legacyPub.descriptionTh).toBe(
      'ผัดกะเพราแท้สูตรโบราณ รสเข้มจัดจ้าน ใช้ใบกะเพราสดและกระเทียมไทยแท้'
    );
    expect(legacyPub.description).toBe(
      'Authentic traditional stir-fried holy basil with bold flavor, fresh holy basil leaves, and Thai garlic.'
    );
    expect(getLocalizedDishDescription('th', legacyPub.description, legacyPub.descriptionTh)).toBe(
      'ผัดกะเพราแท้สูตรโบราณ รสเข้มจัดจ้าน ใช้ใบกะเพราสดและกระเทียมไทยแท้'
    );
    expect(getLocalizedDishDescription('en', legacyPub.description, legacyPub.descriptionTh)).toBe(
      'Authentic traditional stir-fried holy basil with bold flavor, fresh holy basil leaves, and Thai garlic.'
    );

    expect(bilingualPub.descriptionTh).toBe('เส้นจันท์ผัดซอสมะขามสูตรร้าน');
    expect(bilingualPub.description).toBe(
      'Stir-fried Chanthaburi noodles with house tamarind sauce'
    );
    expect(
      getLocalizedDishDescription('th', bilingualPub.description, bilingualPub.descriptionTh)
    ).toBe('เส้นจันท์ผัดซอสมะขามสูตรร้าน');
    expect(
      getLocalizedDishDescription('en', bilingualPub.description, bilingualPub.descriptionTh)
    ).toBe('Stir-fried Chanthaburi noodles with house tamarind sauce');

    expect(resolveBilingualDescriptionFields('Classic English only')).toEqual({
      description: 'Classic English only',
      descriptionTh: '',
    });
  });

  it('assigns daily sequential TK-001 order numbers and DDMMYY-001 AD reference codes and supports searching both', () => {
    const baseOrder = {
      storeId: 'store_1',
      customerUid: 'cust_1',
      orderMode: 'delivery' as const,
      paymentMethod: 'cash' as const,
      items: [],
      subtotal: 100,
      deliveryFee: 20,
      totalAmount: 120,
      status: 'pending' as const,
    };

    // Passed newest-first (as Firestore listener delivers them)
    const sampleOrders = [
      {
        ...baseOrder,
        id: 'ord_day2_first',
        orderNumber: 'ON-261127-9001',
        customerName: 'Somchai',
        customerPhone: '0811112222',
        deliveryAddress: '99 Sukhumvit',
        createdAt: '2026-11-27T02:00:00.000Z', // 09:00 BKK on 27/11/26
      },
      {
        ...baseOrder,
        id: 'ord_day1_second',
        orderNumber: 'ON-261126-0022',
        customerName: 'Malee',
        customerPhone: '0898765432',
        deliveryAddress: '45 Rama 9',
        createdAt: '2026-11-26T05:30:00.000Z', // 12:30 BKK on 26/11/26
      },
      {
        ...baseOrder,
        id: 'ord_day1_first',
        orderNumber: 'ON-261126-0011',
        customerName: 'Niran',
        customerPhone: '0812345678',
        deliveryAddress: '12 Silom',
        createdAt: '2026-11-26T01:15:00.000Z', // 08:15 BKK on 26/11/26
      },
    ];

    const map = buildOnlineOrderNumberingMap(sampleOrders);

    expect(map.get('ord_day1_first')).toEqual({
      sequenceNumber: 1,
      displayNumber: 'TK-001',
      referenceNumber: '261126-001',
      dateKey: '2026-11-26',
    });
    expect(map.get('ord_day1_second')).toEqual({
      sequenceNumber: 2,
      displayNumber: 'TK-002',
      referenceNumber: '261126-002',
      dateKey: '2026-11-26',
    });
    expect(map.get('ord_day2_first')).toEqual({
      sequenceNumber: 1,
      displayNumber: 'TK-001',
      referenceNumber: '271126-001',
      dateKey: '2026-11-27',
    });

    expect(
      matchesOnlineOrderSearch(sampleOrders[1], map.get('ord_day1_second'), 'tk-002')
    ).toBe(true);
    expect(
      matchesOnlineOrderSearch(sampleOrders[1], map.get('ord_day1_second'), '261126-002')
    ).toBe(true);
    expect(
      matchesOnlineOrderSearch(sampleOrders[1], map.get('ord_day1_second'), '0898765432')
    ).toBe(true);
    expect(
      matchesOnlineOrderSearch(sampleOrders[1], map.get('ord_day1_second'), '261126-001')
    ).toBe(false);
  });

  it('routes pending orders to floating alert FIFO and accepted/in-progress orders to POS ONLINE zone until completed', () => {
    const baseOrder = {
      storeId: 'store_1',
      customerUid: 'cust_1',
      customerName: 'Guest',
      customerPhone: '0800000000',
      orderMode: 'delivery' as const,
      paymentMethod: 'cash' as const,
      items: [],
      subtotal: 100,
      deliveryFee: 20,
      totalAmount: 120,
    };

    const orders: OnlineOrderDoc[] = [
      { ...baseOrder, id: 'ord_done', orderNumber: 'ON-1', status: 'completed', createdAt: '2026-11-26T01:00:00.000Z' },
      { ...baseOrder, id: 'ord_cancel', orderNumber: 'ON-2', status: 'cancelled', createdAt: '2026-11-26T01:05:00.000Z' },
      { ...baseOrder, id: 'ord_pending_new', orderNumber: 'ON-3', status: 'pending', createdAt: '2026-11-26T02:30:00.000Z' },
      { ...baseOrder, id: 'ord_pending_old', orderNumber: 'ON-4', status: 'pending', createdAt: '2026-11-26T02:10:00.000Z' },
      { ...baseOrder, id: 'ord_prep', orderNumber: 'ON-5', status: 'preparing', createdAt: '2026-11-26T01:40:00.000Z' },
      { ...baseOrder, id: 'ord_accepted', orderNumber: 'ON-6', status: 'accepted', createdAt: '2026-11-26T01:55:00.000Z' },
      { ...baseOrder, id: 'ord_ready', orderNumber: 'ON-7', status: 'ready_for_pickup', createdAt: '2026-11-26T01:30:00.000Z' },
      { ...baseOrder, id: 'ord_transit', orderNumber: 'ON-8', status: 'out_for_delivery', createdAt: '2026-11-26T01:20:00.000Z' },
    ];

    expect(isOnlineOrderPendingAlert({ status: 'pending' })).toBe(true);
    expect(isOnlineOrderPendingAlert({ status: 'accepted' })).toBe(false);

    expect(isOnlineOrderInActiveZone({ status: 'accepted' })).toBe(true);
    expect(isOnlineOrderInActiveZone({ status: 'preparing' })).toBe(true);
    expect(isOnlineOrderInActiveZone({ status: 'ready_for_pickup' })).toBe(false);
    expect(isOnlineOrderInActiveZone({ status: 'out_for_delivery' })).toBe(false);
    expect(isOnlineOrderInActiveZone({ status: 'pending' })).toBe(false);
    expect(isOnlineOrderInActiveZone({ status: 'completed' })).toBe(false);
    expect(isOnlineOrderInActiveZone({ status: 'cancelled' })).toBe(false);

    // Delivery orders move into RIDER zone & Rider App once marked Ready / Out for delivery
    expect(isOnlineOrderInRiderZone({ status: 'ready_for_pickup', orderMode: 'delivery' })).toBe(true);
    expect(isOnlineOrderInRiderZone({ status: 'out_for_delivery', orderMode: 'delivery' })).toBe(true);
    expect(isOnlineOrderInRiderZone({ status: 'accepted', orderMode: 'delivery' })).toBe(false);
    expect(isOnlineOrderInRiderZone({ status: 'ready_for_pickup', orderMode: 'pickup' })).toBe(false);

    expect(resolveNextReadyActionStatus('pickup')).toBe('completed');
    expect(resolveNextReadyActionStatus('delivery')).toBe('ready_for_pickup');

    // Floating alert queue orders oldest pending order first (FIFO)
    expect(getPendingOnlineOrders(orders).map((o) => o.id)).toEqual([
      'ord_pending_old',
      'ord_pending_new',
    ]);

    // POS ONLINE zone holds kitchen queue (accepted + preparing) chronologically
    expect(getActiveOnlineZoneOrders(orders).map((o) => o.id)).toEqual([
      'ord_prep',
      'ord_accepted',
    ]);

    // POS RIDER zone holds delivery orders awaiting Rider or out for delivery chronologically
    expect(getActiveRiderZoneOrders(orders).map((o) => o.id)).toEqual([
      'ord_transit',
      'ord_ready',
    ]);

    // When remaining orders are marked completed, both ONLINE and RIDER zones become empty (white badge)
    const afterAllDone = orders.map((o) => ({ ...o, status: 'completed' as const }));
    expect(getActiveOnlineZoneOrders(afterAllDone)).toHaveLength(0);
    expect(getActiveRiderZoneOrders(afterAllDone)).toHaveLength(0);
    expect(getPendingOnlineOrders(afterAllDone)).toHaveLength(0);

    // OnlineOrdersManager status filter tabs separate kitchen ('active') vs delivery ('delivering')
    expect(orders.filter((o) => matchesOnlineManagerStatusFilter(o, 'active')).map((o) => o.id)).toEqual([
      'ord_pending_new',
      'ord_pending_old',
      'ord_prep',
      'ord_accepted',
    ]);
    expect(orders.filter((o) => matchesOnlineManagerStatusFilter(o, 'delivering')).map((o) => o.id)).toEqual([
      'ord_ready',
      'ord_transit',
    ]);
    expect(orders.filter((o) => matchesOnlineManagerStatusFilter(o, 'completed')).map((o) => o.id)).toEqual([
      'ord_done',
    ]);
    expect(orders.filter((o) => matchesOnlineManagerStatusFilter(o, 'cancelled')).map((o) => o.id)).toEqual([
      'ord_cancel',
    ]);
  });

  it('enforces 2-minute customer cancellation window across pending, accepted, and preparing states', () => {
    const createdIso = '2026-11-26T04:00:00.000Z';
    const createdMs = new Date(createdIso).getTime();

    expect(canCustomerCancelOrder({ status: 'pending', createdAt: createdIso }, createdMs + 10_000)).toEqual({
      canCancel: true,
      remainingSeconds: 110,
    });
    expect(canCustomerCancelOrder({ status: 'accepted', createdAt: createdIso }, createdMs + 95_000)).toEqual({
      canCancel: true,
      remainingSeconds: 25,
    });
    expect(canCustomerCancelOrder({ status: 'preparing', createdAt: createdIso }, createdMs + 119_500)).toEqual({
      canCancel: true,
      remainingSeconds: 1,
    });

    // Expired at/after 120 seconds
    expect(
      canCustomerCancelOrder(
        { status: 'accepted', createdAt: createdIso },
        createdMs + ONLINE_CUSTOMER_CANCEL_WINDOW_MS
      )
    ).toEqual({
      canCancel: false,
      remainingSeconds: 0,
    });

    // Disallowed once order reaches Ready, Out for Delivery, Completed, or Cancelled
    expect(
      canCustomerCancelOrder({ status: 'ready_for_pickup', createdAt: createdIso }, createdMs + 5_000)
    ).toEqual({
      canCancel: false,
      remainingSeconds: 0,
    });
    expect(
      canCustomerCancelOrder({ status: 'completed', createdAt: createdIso }, createdMs + 5_000)
    ).toEqual({
      canCancel: false,
      remainingSeconds: 0,
    });

    expect(formatCountdownMMSS(120)).toBe('02:00');
    expect(formatCountdownMMSS(65)).toBe('01:05');
    expect(formatCountdownMMSS(0)).toBe('00:00');
  });

  it('persists saved customer delivery addresses with GPS coordinates and per-store favorites', () => {
    const memStorage = new Map<string, string>();
    const prevStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => memStorage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memStorage.set(k, v);
        },
        removeItem: (k: string) => {
          memStorage.delete(k);
        },
        clear: () => {
          memStorage.clear();
        },
      },
    });

    try {
      expect(loadSavedCustomerAddresses()).toEqual([]);

      const afterAdd1 = upsertSavedCustomerAddress({
        label: 'บ้าน',
        customerName: 'Nok',
        customerPhone: '0811111111',
        address: '88/9 Sukhumvit 55',
        lat: 13.736717,
        lng: 100.58312,
        isDefault: true,
      });
      expect(afterAdd1).toHaveLength(1);
      expect(afterAdd1[0].isDefault).toBe(true);
      expect(afterAdd1[0].lat).toBeCloseTo(13.736717, 6);

      const afterAdd2 = upsertSavedCustomerAddress({
        label: 'ออฟฟิศ',
        customerName: 'Nok',
        customerPhone: '0811111111',
        address: '101 Silom',
        lat: 13.7265,
        lng: 100.5289,
        isDefault: false,
      });
      expect(afterAdd2).toHaveLength(2);
      const officeId = afterAdd2[0].id;

      const afterEdit = upsertSavedCustomerAddress({
        id: officeId,
        label: 'ออฟฟิศใหม่',
        customerName: 'Nok',
        customerPhone: '0899999999',
        address: '102 Silom Complex',
        lat: 13.728,
        lng: 100.535,
        isDefault: false,
      });
      expect(afterEdit.find((a) => a.id === officeId)?.address).toBe('102 Silom Complex');

      const afterDefault = setDefaultCustomerAddress(officeId);
      expect(afterDefault.find((a) => a.id === officeId)?.isDefault).toBe(true);

      const afterDelete = deleteSavedCustomerAddress(officeId);
      expect(afterDelete).toHaveLength(1);
      expect(afterDelete[0].isDefault).toBe(true);

      // Favorites per store
      expect(loadCustomerFavoriteDishIds('store_a')).toEqual([]);
      expect(toggleCustomerFavoriteDishId('dish_1', 'store_a')).toEqual(['dish_1']);
      expect(toggleCustomerFavoriteDishId('dish_2', 'store_a')).toEqual(['dish_2', 'dish_1']);
      expect(loadCustomerFavoriteDishIds('store_b')).toEqual([]);
      expect(toggleCustomerFavoriteDishId('dish_1', 'store_a')).toEqual(['dish_2']);
    } finally {
      if (prevStorage === undefined) {
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          value: prevStorage,
        });
      }
    }
  });

  it('persists, edits, and deletes customized customer favorite items with selected options per store', () => {
    const memStorage = new Map<string, string>();
    const prevStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => memStorage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memStorage.set(k, v);
        },
        removeItem: (k: string) => {
          memStorage.delete(k);
        },
        clear: () => {
          memStorage.clear();
        },
      },
    });

    try {
      expect(loadSavedCustomerFavoriteItems('store_a')).toEqual([]);

      const saved1 = upsertSavedCustomerFavoriteItem({
        storeId: 'store_a',
        dishId: 'dish_kapao',
        variantId: 'var_special',
        selectedOptions: {
          grp_egg: { opt_fried_egg: 1, opt_ignored_zero: 0 },
          grp_spice: { opt_medium_spicy: 1 },
        },
        notes: 'ไม่ใส่ถั่วฝักยาว',
      });
      expect(saved1).toHaveLength(1);
      const favId = saved1[0].id;
      expect(saved1[0].variantId).toBe('var_special');
      expect(saved1[0].selectedOptions).toEqual({
        grp_egg: { opt_fried_egg: 1 },
        grp_spice: { opt_medium_spicy: 1 },
      });
      expect(saved1[0].notes).toBe('ไม่ใส่ถั่วฝักยาว');
      expect(loadCustomerFavoriteDishIds('store_a')).toContain('dish_kapao');
      expect(loadSavedCustomerFavoriteItems('store_b')).toEqual([]);

      // Edit existing favorite in place
      const updated = upsertSavedCustomerFavoriteItem({
        id: favId,
        storeId: 'store_a',
        dishId: 'dish_kapao',
        variantId: 'var_normal',
        selectedOptions: {
          grp_egg: { opt_omelette: 2 },
          grp_spice: { opt_extra_spicy: 1 },
        },
        notes: 'แยกข้าว',
      });
      expect(updated).toHaveLength(1);
      expect(updated[0].id).toBe(favId);
      expect(updated[0].variantId).toBe('var_normal');
      expect(updated[0].selectedOptions).toEqual({
        grp_egg: { opt_omelette: 2 },
        grp_spice: { opt_extra_spicy: 1 },
      });
      expect(updated[0].notes).toBe('แยกข้าว');

      // Delete customized favorite
      const afterDelete = deleteSavedCustomerFavoriteItem(favId, 'store_a');
      expect(afterDelete).toEqual([]);
    } finally {
      if (prevStorage === undefined) {
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          value: prevStorage,
        });
      }
    }
  });

  it('round-trips Bangkok coordinates accurately through Web Mercator projection helpers', () => {
    const bangkokLat = 13.756331;
    const bangkokLng = 100.501762;
    for (const zoom of [14, 17, 19]) {
      const px = latLngToMercatorPixel(bangkokLat, bangkokLng, zoom);
      const unprojected = mercatorPixelToLatLng(px.x, px.y, zoom);
      expect(unprojected.lat).toBeCloseTo(bangkokLat, 5);
      expect(unprojected.lng).toBeCloseTo(bangkokLng, 5);
    }

    // Shifting East (+x) increases longitude; shifting South (+y) decreases latitude
    const centerPx = latLngToMercatorPixel(bangkokLat, bangkokLng, 17);
    const eastSouth = mercatorPixelToLatLng(centerPx.x + 120, centerPx.y + 80, 17);
    expect(eastSouth.lng).toBeGreaterThan(bangkokLng);
    expect(eastSouth.lat).toBeLessThan(bangkokLat);
  });

  it('fetches GPS with automatic low-accuracy fallback for iOS CoreLocation errors (codes 2 & 3) without retrying permission denial (code 1)', async () => {
    const calls: PositionOptions[] = [];

    // 1) High-accuracy succeeds directly and rounds coordinates to 6 decimal places
    const directRes = await getCurrentPositionWithIosFallback({
      getCurrentPosition: (success, _error, options) => {
        if (options) calls.push(options);
        success({
          coords: {
            latitude: 13.75633149,
            longitude: 100.50176249,
            accuracy: 12,
          },
        } as GeolocationPosition);
      },
    });
    expect(directRes).toEqual({ lat: 13.756331, lng: 100.501762, accuracy: 12 });
    expect(calls[0]?.enableHighAccuracy).toBe(true);

    // 2) High-accuracy fails on iOS indoors with POSITION_UNAVAILABLE (2) -> falls back to enableHighAccuracy: false
    const fallbackCalls: PositionOptions[] = [];
    const fallbackRes = await getCurrentPositionWithIosFallback({
      getCurrentPosition: (success, error, options) => {
        if (options) fallbackCalls.push(options);
        if (options?.enableHighAccuracy) {
          error?.({ code: 2, message: 'CoreLocationProvider: kCLErrorLocationUnknown' } as GeolocationPositionError);
          return;
        }
        success({
          coords: {
            latitude: 13.7462,
            longitude: 100.5347,
            accuracy: 65,
          },
        } as GeolocationPosition);
      },
    });
    expect(fallbackCalls).toHaveLength(2);
    expect(fallbackCalls[0]?.enableHighAccuracy).toBe(true);
    expect(fallbackCalls[1]?.enableHighAccuracy).toBe(false);
    expect(fallbackRes).toEqual({ lat: 13.7462, lng: 100.5347, accuracy: 65 });

    // 3) Permission denied (1) must reject immediately without spurious second prompt
    const deniedCalls: PositionOptions[] = [];
    await expect(
      getCurrentPositionWithIosFallback({
        getCurrentPosition: (_success, error, options) => {
          if (options) deniedCalls.push(options);
          error?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError);
        },
      })
    ).rejects.toMatchObject({ code: 1 });
    expect(deniedCalls).toHaveLength(1);
  });
});


