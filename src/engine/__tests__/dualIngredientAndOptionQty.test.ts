import { describe, it, expect } from 'vitest';
import {
  calculateOptionChoiceCost,
  isOptionChoiceQuantityEnabled,
  getOptionChoiceEffectiveQuantity,
} from '../calculations';
import {
  sanitizeMenuForPublicStore,
  calculateOnlineOrderCostSnapshot,
} from '../onlineOrdering';
import {
  calculateSpreadsheetRowMetrics,
} from '../../costing/services/spreadsheetCostHelper';
import {
  calculateVariantCostBreakdown,
} from '../../costing/services/calculationEngine';
import type {
  Ingredient,
  MenuItem,
  MenuVariant,
  RestaurantSettings,
  Sauce,
} from '../../costing/types';
import type {
  CategoryDoc,
  DishDoc,
  IngredientDoc,
  OptionChoice,
  OptionGroupDoc,
  PackagingDoc,
  SettingsDoc,
  SubRecipeDoc,
} from '../../types';

const nowIso = '2026-11-20T05:00:00.000Z';

function makeCostSettings(
  overrides: Partial<RestaurantSettings> = {}
): RestaurantSettings {
  return {
    restaurantName: "Tony's Kit",
    defaultOverheadCostPerDish: 0,
    targetFoodCostPercent: 35,
    targetProfitAmount: 25,
    takeawayPackagingCost: 5,
    deliveryPackagingCost: 8,
    grabFoodCommissionPercent: 30,
    grabFoodCommissionHasVat: true,
    lineManCommissionPercent: 25,
    lineManCommissionHasVat: true,
    commissionVatAsCost: true,
    vatRatePercent: 7,
    pricesIncludeVat: false,
    salesVatInclusive: false,
    serviceChargeIncludedInPrice: false,
    serviceChargePercent: 0,
    priceRounding: 1,
    defaultTicketSize: 140,
    channels: [],
    userRole: 'OWNER',
    ...overrides,
  };
}

function makeCostIngredient(
  overrides: Partial<Ingredient> & Pick<Ingredient, 'id' | 'name'>
): Ingredient {
  return {
    category: 'เนื้อสัตว์และอาหารทะเล',
    purchaseQuantity: 1000,
    purchaseUnit: 'g',
    purchasePrice: 200,
    actualQuantity: 1000,
    actualUnit: 'g',
    yieldPercent: 100,
    actualCost: 200,
    baseUnit: 'g',
    costPerBaseUnit: 0.2,
    usageUnit: 'g',
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides,
  };
}

describe('Dual-Ingredient Variant Costing & Option Choice Quantity', () => {
  describe('1. OptionChoice.quantity in calculateOptionChoiceCost & Online Ordering', () => {
    const eggIng: IngredientDoc = {
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
    };
    const cheeseIng: IngredientDoc = {
      id: 'ing_cheese',
      name: 'Cheese Slice',
      purchaseUnit: 'piece',
      purchasePrice: 12,
      purchaseQuantity: 1,
      yieldPercent: 100,
      baseUnit: 'piece',
      costPerBaseUnit: 12,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    const ingredientsMap = new Map<string, IngredientDoc>([
      [eggIng.id, eggIng],
      [cheeseIng.id, cheeseIng],
    ]);

    it('treats undefined quantity as 1x and multiplies choice ingredient cost by explicit quantity > 1', () => {
      const defaultChoice: OptionChoice = {
        id: 'ch_egg_1',
        name: 'Fried Egg',
        nameTh: 'ไข่ดาว',
        price: 15,
        ingredients: [{ ingredientId: 'ing_egg', quantity: 1 }],
      };
      const tripleChoice: OptionChoice = {
        ...defaultChoice,
        id: 'ch_egg_3',
        quantity: 3,
      };
      const multiIngChoice: OptionChoice = {
        id: 'ch_combo_2',
        name: 'Double Egg & Cheese',
        price: 45,
        quantity: 2,
        ingredients: [
          { ingredientId: 'ing_egg', quantity: 1 },
          { ingredientId: 'ing_cheese', quantity: 1 },
        ],
      };

      expect(calculateOptionChoiceCost(defaultChoice, ingredientsMap)).toEqual({
        cost: 5,
        hasMissing: false,
      });
      expect(calculateOptionChoiceCost(tripleChoice, ingredientsMap)).toEqual({
        cost: 15,
        hasMissing: false,
      });
      expect(calculateOptionChoiceCost(multiIngChoice, ingredientsMap)).toEqual({
        cost: 34, // 2 * (5 + 12)
        hasMissing: false,
      });
    });

    it('respects hasQuantity toggle: disables quantity even with stale quantity > 1 and treats hasQuantity=false as 1x', () => {
      expect(isOptionChoiceQuantityEnabled({ hasQuantity: undefined, quantity: 1 })).toBe(false);
      expect(isOptionChoiceQuantityEnabled({ hasQuantity: undefined, quantity: 3 })).toBe(true);
      expect(isOptionChoiceQuantityEnabled({ hasQuantity: false, quantity: 3 })).toBe(false);
      expect(isOptionChoiceQuantityEnabled({ hasQuantity: true, quantity: 2 })).toBe(true);

      expect(getOptionChoiceEffectiveQuantity({ hasQuantity: undefined, quantity: 1 })).toBe(1);
      expect(getOptionChoiceEffectiveQuantity({ hasQuantity: undefined, quantity: 3 })).toBe(3);
      expect(getOptionChoiceEffectiveQuantity({ hasQuantity: false, quantity: 3 })).toBe(1);
      expect(getOptionChoiceEffectiveQuantity({ hasQuantity: true, quantity: 2 })).toBe(2);

      const disabledWithStaleQty: OptionChoice = {
        id: 'ch_no_qty',
        name: 'Less Spicy',
        nameTh: 'เผ็ดน้อย',
        price: 0,
        hasQuantity: false,
        quantity: 3, // stale value must be ignored when hasQuantity is false
        ingredients: [{ ingredientId: 'ing_egg', quantity: 1 }],
      };

      expect(calculateOptionChoiceCost(disabledWithStaleQty, ingredientsMap)).toEqual({
        cost: 5, // 1x instead of 3x
        hasMissing: false,
      });
    });

    it('preserves quantity > 1 on PublicOptionChoice (omitting default 1) while stripping private cost fields, and factors quantity into calculateOnlineOrderCostSnapshot', () => {
      const settings: SettingsDoc = {
        id: 'main',
        shopName: "Tony's Kit",
        shopAddress: '123 Sukhumvit',
        shopPhone: '02-000-0000',
        taxId: '0105558000000',
        receiptHeader: 'Welcome',
        receiptFooter: 'Thanks',
        targetFoodCostPercent: 35,
        vatPercent: 7,
        serviceChargePercent: 0,
        dailyClosingTime: '04:00',
        pointsEarnUnitThb: 100,
        pointsRedeemValueThb: 1,
        pricesIncludeVat: false,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      };

      const categories: CategoryDoc[] = [
        { id: 'cat_1', name: 'Mains', order: 1, createdAt: nowIso, updatedAt: nowIso, version: 1 },
      ];

      const optionGroups: OptionGroupDoc[] = [
        {
          id: 'grp_addons',
          name: 'Add-ons',
          nameTh: 'เพิ่มเติม',
          minSelect: 0,
          maxSelect: 3,
          order: 1,
          choices: [
            {
              id: 'ch_default_1',
              name: '1 Fried Egg',
              price: 15,
              quantity: 1,
              ingredients: [{ ingredientId: 'ing_egg', quantity: 1 }],
            },
            {
              id: 'ch_triple_3',
              name: '3 Fried Eggs',
              price: 40,
              hasQuantity: true,
              quantity: 3,
              ingredients: [{ ingredientId: 'ing_egg', quantity: 1 }],
            },
            {
              id: 'ch_disabled_stale',
              name: 'Extra Herb',
              price: 10,
              hasQuantity: false,
              quantity: 4,
              ingredients: [{ ingredientId: 'ing_egg', quantity: 1 }],
            },
          ],
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        },
      ];

      const dishes: DishDoc[] = [
        {
          id: 'dish_1',
          name: 'Basil Stir Fry',
          nameTh: 'ผัดกะเพรา',
          categoryId: 'cat_1',
          order: 1,
          optionGroupIds: ['grp_addons'],
          variants: [
            {
              id: 'var_1',
              name: 'Regular',
              price: 79,
              ingredients: [{ ingredientId: 'ing_cheese', quantity: 1 }], // 12 THB base food cost
              subRecipes: [],
              packaging: [{ packagingId: 'pkg_box', quantity: 1 }], // 4 THB
            },
          ],
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        },
      ];

      const { publicStore } = sanitizeMenuForPublicStore({
        storeId: 'main',
        settings,
        categories,
        dishes,
        optionGroups,
      });

      const pubGroup = publicStore.optionGroups[0];
      expect(pubGroup.choices[0]).toEqual({
        id: 'ch_default_1',
        name: '1 Fried Egg',
        price: 15,
      });
      expect('ingredients' in pubGroup.choices[0]).toBe(false);
      expect(pubGroup.choices[1]).toEqual({
        id: 'ch_triple_3',
        name: '3 Fried Eggs',
        price: 40,
        quantity: 3,
      });
      expect('ingredients' in pubGroup.choices[1]).toBe(false);
      // Disabled choice with stale quantity: 4 omits quantity from public choice
      expect(pubGroup.choices[2]).toEqual({
        id: 'ch_disabled_stale',
        name: 'Extra Herb',
        price: 10,
      });
      expect('quantity' in pubGroup.choices[2]).toBe(false);

      const snapshot = calculateOnlineOrderCostSnapshot({
        items: [
          {
            dishId: 'dish_1',
            dishName: 'Basil Stir Fry',
            variantId: 'var_1',
            variantName: 'Regular',
            quantity: 2,
            unitPrice: 119,
            options: [
              {
                groupId: 'grp_addons',
                groupName: 'Add-ons',
                choiceId: 'ch_triple_3',
                choiceName: '3 Fried Eggs',
                price: 40,
              },
              {
                groupId: 'grp_addons',
                groupName: 'Add-ons',
                choiceId: 'ch_disabled_stale',
                choiceName: 'Extra Herb',
                price: 10,
              },
            ],
          },
        ],
        dishesMap: new Map(dishes.map((d) => [d.id, d])),
        optionGroupsMap: new Map(optionGroups.map((g) => [g.id, g])),
        ingredientsMap,
        subRecipesMap: new Map<string, SubRecipeDoc>(),
        packagingMap: new Map<string, PackagingDoc>([
          [
            'pkg_box',
            {
              id: 'pkg_box',
              name: 'Box',
              cost: 4,
              unit: 'piece',
              createdAt: nowIso,
              updatedAt: nowIso,
              version: 1,
            },
          ],
        ]),
      });

      // Base dish 12 + (1 egg * 5 * 3 = 15) + (1 egg * 5 * 1 = 5) = 32 per order item * 2 qty = 64
      expect(snapshot.foodCost).toBeCloseTo(64, 2);
      expect(snapshot.packagingCost).toBeCloseTo(8, 2);
    });
  });

  describe('2. Dual-Ingredient Non-Seafood & Seafood Costing (Spreadsheet + Breakdown)', () => {
    it('calculates combined dual-ingredient proteinCost with unit conversion, avoids centralCost double counting, and classifies OTHER into meatCost', () => {
      // Primary 1: PORK stored in kg (1 kg = 180 THB -> 0.18 THB/g), used in recipe as 100 g -> 18 THB
      const porkIng = makeCostIngredient({
        id: 'ing_pork',
        name: 'หมูสับ',
        purchaseQuantity: 1,
        purchaseUnit: 'kg',
        purchasePrice: 180,
        actualQuantity: 1,
        actualUnit: 'kg',
        baseUnit: 'kg',
        usageUnit: 'kg',
        costPerBaseUnit: 180,
      });
      // Primary 2: OTHER (crispy pork / หมูกรอบ or กุนเชียง) in g (0.35 THB/g), used as 40 g -> 14 THB
      const sausageIng = makeCostIngredient({
        id: 'ing_lapcheong',
        name: 'กุนเชียง',
        purchaseQuantity: 1000,
        purchaseUnit: 'g',
        purchasePrice: 350,
        actualQuantity: 1000,
        actualUnit: 'g',
        baseUnit: 'g',
        usageUnit: 'g',
        costPerBaseUnit: 0.35,
      });
      const riceIng = makeCostIngredient({
        id: 'ing_cooked_rice',
        name: 'ข้าวสวย',
        category: 'ข้าวและเส้น',
        purchaseQuantity: 1000,
        purchaseUnit: 'g',
        purchasePrice: 40,
        actualQuantity: 1000,
        actualUnit: 'g',
        baseUnit: 'g',
        usageUnit: 'g',
        costPerBaseUnit: 0.04,
      });
      const sauceIng = makeCostIngredient({
        id: 'ing_sauce',
        name: 'ซอสผัดอเนกประสงค์',
        category: 'เครื่องปรุงและซอส',
        purchaseQuantity: 1000,
        purchaseUnit: 'g',
        purchasePrice: 200,
        actualQuantity: 1000,
        actualUnit: 'g',
        baseUnit: 'g',
        usageUnit: 'g',
        costPerBaseUnit: 0.2,
      });

      const ingMap = new Map<string, Ingredient>([
        [porkIng.id, porkIng],
        [sausageIng.id, sausageIng],
        [riceIng.id, riceIng],
        [sauceIng.id, sauceIng],
      ]);

      const menu: MenuItem = {
        id: 'menu_combo',
        name: 'ผัดกะเพราคู่พิเศษ',
        category: 'ผัดและกะเพรา',
        active: true,
        variants: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const dualVariant: MenuVariant = {
        id: 'var_dual',
        menuId: 'menu_combo',
        name: 'กะเพราหมูสับ + กุนเชียง',
        proteinType: 'หมูสับ + กุนเชียง',
        sellingPrice: 120,
        takeawayPrice: 125,
        deliveryPrice: 160,
        overheadCost: 20,
        packagingCost: 7,
        active: true,
        recipeItems: [
          {
            id: 'primary_1_pork',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_pork',
            name: 'หมูสับ',
            proteinCategory: 'PORK',
            quantity: 100, // 100g @ 0.18 = 18 THB
            unit: 'g',
            calculatedUnitCost: 0.18,
            calculatedLineCost: 18,
          },
          {
            id: 'primary_2_other',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_lapcheong',
            name: 'กุนเชียง',
            proteinCategory: 'OTHER',
            quantity: 40, // 40g @ 0.35 = 14 THB
            unit: 'g',
            calculatedUnitCost: 0.35,
            calculatedLineCost: 14,
          },
          {
            id: 'central_rice',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_cooked_rice',
            name: 'ข้าวสวย',
            quantity: 200, // 200g @ 0.04 = 8 THB
            unit: 'g',
            calculatedUnitCost: 0.04,
            calculatedLineCost: 8,
          },
          {
            id: 'central_sauce',
            ingredientType: 'SAUCE',
            ingredientId: 'sauce_pad',
            name: 'ซอสผัดอเนกประสงค์',
            quantity: 60, // 60g @ 0.20 = 12 THB
            unit: 'g',
            calculatedUnitCost: 0.2,
            calculatedLineCost: 12,
          },
        ],
      };

      const sauceMap = new Map<string, Sauce>([
        [
          'sauce_pad',
          {
            id: 'sauce_pad',
            name: 'ซอสผัดอเนกประสงค์',
            productionQuantity: 1000,
            productionUnit: 'g',
            actualQuantity: 1000,
            yieldPercent: 100,
            productionCost: 200,
            actualCost: 200,
            costPerGram: 0.2,
            active: true,
            createdAt: nowIso,
            updatedAt: nowIso,
            items: [
              {
                ingredientId: 'ing_sauce',
                ingredientName: 'ซอสผัดอเนกประสงค์',
                quantity: 1000,
                unit: 'g',
                unitCost: 0.2,
                lineCost: 200,
              },
            ],
          },
        ],
      ]);

      const metrics = calculateSpreadsheetRowMetrics({
        menu,
        variant: dualVariant,
        ingredientsMap: ingMap,
        servingMode: 'ON_RICE',
      });

      expect(metrics.isSeafood).toBe(false);
      expect(metrics.proteinWeight).toBe(100);
      expect(metrics.secondaryProteinWeight).toBe(40);
      expect(metrics.proteinUnitCost).toBeCloseTo(0.18, 4);
      expect(metrics.proteinCost).toBe(32); // 18 + 14
      expect(metrics.centralCost).toBe(20); // 8 (rice) + 12 (sauce), neither primary double-counted!
      expect(metrics.totalRawMaterialCost).toBe(52); // 32 + 20

      // A la carte mode excludes cooked rice from centralCost, keeps sauce and dual proteins
      const alaCarteMetrics = calculateSpreadsheetRowMetrics({
        menu,
        variant: dualVariant,
        ingredientsMap: ingMap,
        servingMode: 'A_LA_CARTE',
      });
      expect(alaCarteMetrics.proteinCost).toBe(32);
      expect(alaCarteMetrics.centralCost).toBe(12);
      expect(alaCarteMetrics.totalRawMaterialCost).toBe(44);

      // Variant Cost Breakdown classifies both PORK and OTHER into meatCost and sums total correctly
      const breakdown = calculateVariantCostBreakdown(
        dualVariant,
        menu.name,
        ingMap,
        sauceMap,
        makeCostSettings()
      );
      expect(breakdown.meatCost).toBeCloseTo(32, 4); // 18 + 14
      expect(breakdown.sauceCost).toBeCloseTo(12, 4);
      expect(breakdown.centralIngredientCost).toBeCloseTo(8, 4);
      expect(breakdown.totalIngredientCost).toBeCloseTo(52, 4);
    });

    it('supports secondaryProteinWeightOverride on non-seafood dual-ingredient rows and shrimp/squid overrides on seafood rows', () => {
      const chickenIng = makeCostIngredient({
        id: 'ing_chicken',
        name: 'อกไก่',
        costPerBaseUnit: 0.1,
        purchasePrice: 100,
      });
      const sausageIng = makeCostIngredient({
        id: 'ing_sausage',
        name: 'ไส้กรอกไก่',
        costPerBaseUnit: 0.25,
        purchasePrice: 250,
      });
      const shrimpIng = makeCostIngredient({
        id: 'ing_shrimp',
        name: 'กุ้งสด',
        purchaseQuantity: 1,
        purchaseUnit: 'ตัว',
        purchasePrice: 9,
        actualQuantity: 1,
        actualUnit: 'ตัว',
        baseUnit: 'ตัว',
        usageUnit: 'ตัว',
        costPerBaseUnit: 9,
      });
      const squidIng = makeCostIngredient({
        id: 'ing_squid',
        name: 'ปลาหมึก',
        costPerBaseUnit: 0.4,
        purchasePrice: 400,
      });
      const vegIng = makeCostIngredient({
        id: 'ing_veg',
        name: 'ใบกะเพรา',
        category: 'ผักและสมุนไพร',
        costPerBaseUnit: 0.2,
        purchasePrice: 200,
      });

      const ingMap = new Map<string, Ingredient>([
        [chickenIng.id, chickenIng],
        [sausageIng.id, sausageIng],
        [shrimpIng.id, shrimpIng],
        [squidIng.id, squidIng],
        [vegIng.id, vegIng],
      ]);

      const menu: MenuItem = {
        id: 'menu_mixed',
        name: 'ผัดกะเพรา',
        category: 'ผัดและกะเพรา',
        active: true,
        variants: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const nonSeafoodDual: MenuVariant = {
        id: 'var_chx_saus',
        menuId: 'menu_mixed',
        name: 'อกไก่ + ไส้กรอก',
        proteinType: 'ไก่ + ไส้กรอก',
        sellingPrice: 89,
        takeawayPrice: 94,
        deliveryPrice: 120,
        overheadCost: 20,
        active: true,
        recipeItems: [
          {
            id: 'primary_1_chx',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_chicken',
            name: 'อกไก่',
            proteinCategory: 'CHICKEN',
            quantity: 70, // 7 THB
            unit: 'g',
            calculatedUnitCost: 0.1,
            calculatedLineCost: 7,
          },
          {
            id: 'primary_2_saus',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_sausage',
            name: 'ไส้กรอกไก่',
            proteinCategory: 'OTHER',
            quantity: 40, // 10 THB
            unit: 'g',
            calculatedUnitCost: 0.25,
            calculatedLineCost: 10,
          },
          {
            id: 'central_veg',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_veg',
            name: 'ใบกะเพรา',
            quantity: 50, // 10 THB
            unit: 'g',
            calculatedUnitCost: 0.2,
            calculatedLineCost: 10,
          },
        ],
      };

      const overridden = calculateSpreadsheetRowMetrics({
        menu,
        variant: nonSeafoodDual,
        ingredientsMap: ingMap,
        proteinWeightOverride: 100, // 100 * 0.1 = 10
        secondaryProteinWeightOverride: 80, // 80 * 0.25 = 20
      });
      expect(overridden.proteinWeight).toBe(100);
      expect(overridden.secondaryProteinWeight).toBe(80);
      expect(overridden.proteinCost).toBe(30); // 10 + 20
      expect(overridden.centralCost).toBe(10); // neither chicken nor sausage counted in central

      const seafoodVar: MenuVariant = {
        id: 'var_seafood',
        menuId: 'menu_mixed',
        name: 'ทะเล',
        proteinType: 'ทะเล',
        sellingPrice: 129,
        takeawayPrice: 134,
        deliveryPrice: 170,
        overheadCost: 30,
        active: true,
        recipeItems: [
          {
            id: 'primary_1_shrimp',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_shrimp',
            name: 'กุ้งสด',
            proteinCategory: 'SHRIMP',
            quantity: 4,
            unit: 'ตัว',
            calculatedUnitCost: 9,
            calculatedLineCost: 36,
          },
          {
            id: 'primary_2_squid',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_squid',
            name: 'ปลาหมึก',
            proteinCategory: 'SQUID',
            quantity: 40,
            unit: 'g',
            calculatedUnitCost: 0.4,
            calculatedLineCost: 16,
          },
          {
            id: 'central_veg',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_veg',
            name: 'ใบกะเพรา',
            quantity: 50, // 10 THB
            unit: 'g',
            calculatedUnitCost: 0.2,
            calculatedLineCost: 10,
          },
        ],
      };

      const seafoodMetrics = calculateSpreadsheetRowMetrics({
        menu,
        variant: seafoodVar,
        ingredientsMap: ingMap,
        shrimpQtyOverride: 5, // 5 * 9 = 45
        squidQtyOverride: 50, // 50 * 0.4 = 20
      });
      expect(seafoodMetrics.isSeafood).toBe(true);
      expect(seafoodMetrics.shrimpQty).toBe(5);
      expect(seafoodMetrics.squidQty).toBe(50);
      expect(seafoodMetrics.shrimpTotalCost).toBe(45);
      expect(seafoodMetrics.squidTotalCost).toBe(20);
      expect(seafoodMetrics.proteinCost).toBe(65);
      expect(seafoodMetrics.centralCost).toBe(10);
    });
  });
});
