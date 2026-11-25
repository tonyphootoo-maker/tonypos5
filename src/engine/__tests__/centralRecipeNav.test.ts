import { describe, it, expect } from 'vitest';
import {
  resolveCentralRecipeMenuTarget,
  getCentralRecipeOriginLabel,
  CENTRAL_RECIPE_BUTTON_LABELS,
  derivePackagingFromBaseRecipe,
  applyBaseRecipeToVariant,
  syncBaseRecipeToLinkedMenus,
  detachBaseRecipeFromMenus,
  isRiceNoodleRecipeItem,
  buildRecipeItemFromRiceNoodlePortion,
  computeRiceNoodleRecipeItemCost,
  syncRiceNoodlePortionToBaseRecipes,
} from '../../costing/utils/centralRecipeNav';
import { calculateVariantCostBreakdown } from '../../costing/services/calculationEngine';
import { INITIAL_RICE_NOODLE_PORTIONS, INITIAL_SETTINGS } from '../../costing/data/initialData';
import {
  CentralBaseRecipe,
  Ingredient,
  MenuItem,
  MenuVariant,
  RecipeItem,
  RiceNoodlePortion,
  Sauce,
} from '../../costing/types';

function makeVariant(id: string, menuId: string, active = true): MenuVariant {
  return {
    id,
    menuId,
    name: `Variant ${id}`,
    proteinType: 'หมูสับ',
    sellingPrice: 65,
    takeawayPrice: 70,
    deliveryPrice: 95,
    overheadCost: 6,
    recipeItems: [],
    active,
  };
}

function makeMenu(id: string, name: string, variants: MenuVariant[], active = true): MenuItem {
  return {
    id,
    name,
    category: 'ผัดและกะเพรา',
    variants,
    active,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('centralRecipeNav helpers', () => {
  const menus: MenuItem[] = [
    makeMenu('menu_1', 'ข้าวกะเพรา', [
      makeVariant('var_1a', 'menu_1', true),
      makeVariant('var_1b_inactive', 'menu_1', false),
    ]),
    makeMenu('menu_2', 'ข้าวผัด', [makeVariant('var_2a', 'menu_2', true)]),
    makeMenu('menu_3_inactive', 'เมนูที่ปิดใช้งาน', [makeVariant('var_3a', 'menu_3_inactive', true)], false),
  ];

  it('resolves exact menu & variant when variantId is active inside an active menu', () => {
    const res = resolveCentralRecipeMenuTarget(menus, { variantId: 'var_2a' });
    expect(res?.menu.id).toBe('menu_2');
    expect(res?.variant?.id).toBe('var_2a');
  });

  it('falls back to menuId when variantId is missing or inactive', () => {
    const res1 = resolveCentralRecipeMenuTarget(menus, { menuId: 'menu_1' });
    expect(res1?.menu.id).toBe('menu_1');
    expect(res1?.variant).toBeUndefined();

    const res2 = resolveCentralRecipeMenuTarget(menus, {
      variantId: 'var_1b_inactive',
      menuId: 'menu_1',
    });
    expect(res2?.menu.id).toBe('menu_1');
    expect(res2?.variant).toBeUndefined();
  });

  it('returns null for deleted or inactive menus and variants without active fallback', () => {
    expect(resolveCentralRecipeMenuTarget(menus, { variantId: 'var_3a' })).toBeNull();
    expect(resolveCentralRecipeMenuTarget(menus, { menuId: 'menu_3_inactive' })).toBeNull();
    expect(resolveCentralRecipeMenuTarget(menus, { variantId: 'var_1b_inactive' })).toBeNull();
    expect(resolveCentralRecipeMenuTarget(menus, { variantId: 'non_existent', menuId: 'missing' })).toBeNull();
    expect(resolveCentralRecipeMenuTarget(menus, null)).toBeNull();
    expect(resolveCentralRecipeMenuTarget([], { menuId: 'menu_1' })).toBeNull();
  });

  it('returns localized origin labels for return navigation', () => {
    expect(getCentralRecipeOriginLabel('menu_cost', 'th')).toBe('จัดการเมนู');
    expect(getCentralRecipeOriginLabel('pos', 'th')).toBe('โต๊ะ / จุดขาย (POS)');
    expect(getCentralRecipeOriginLabel('cost_food_cost', 'th')).toBe('ต้นทุนอาหาร / เมนู');
    expect(getCentralRecipeOriginLabel('cost_food_cost_alacarte', 'th')).toBe(
      'ต้นทุนอาหาร / เมนู (กับข้าว)'
    );
    expect(getCentralRecipeOriginLabel('menu_cost', 'en')).toBe('Menu Management');
    expect(getCentralRecipeOriginLabel(null, 'th')).toBe('');
  });

  it('keeps exact required Thai labels and unresolved hint', () => {
    expect(CENTRAL_RECIPE_BUTTON_LABELS.openTh).toBe('เปิดสูตรกลางของเมนูนี้');
    expect(CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenTh).toBe('บันทึกแล้วไปที่สูตรกลาง');
    expect(CENTRAL_RECIPE_BUTTON_LABELS.unresolvedHintTh).toBe(
      'ยังไม่พบสูตรกลางที่เชื่อมกับตัวเลือกนี้ กรุณาเชื่อมข้อมูลจากต้นทุนอาหารก่อน'
    );
  });
});

describe('CentralBaseRecipe & RiceNoodlePortion helpers', () => {
  const makeBaseRecipe = (): CentralBaseRecipe => ({
    id: 'base_kaprao',
    name: 'สูตรกะเพรากลาง',
    englishName: 'Central Kaprao Base',
    items: [
      {
        id: 'base_sauce_1',
        type: 'SAUCE',
        ingredientType: 'SAUCE',
        ingredientId: 'sauce_1',
        sauceId: 'sauce_1',
        name: 'ซอสกะเพรา',
        quantity: 30,
        unit: 'g',
        calculatedUnitCost: 0.1,
        calculatedLineCost: 3,
      },
      {
        id: 'base_pkg_1',
        type: 'PACKAGING',
        ingredientType: 'PACKAGING',
        ingredientId: 'pkg_kraft',
        name: 'กล่องกระดาษ',
        quantity: 1,
        unit: 'ชิ้น',
        calculatedUnitCost: 2.5,
        calculatedLineCost: 2.5,
      },
      {
        id: 'base_pkg_2',
        type: 'PACKAGING',
        ingredientType: 'PACKAGING',
        ingredientId: 'pkg_cutlery',
        name: 'ช้อนส้อม',
        quantity: 1,
        unit: 'ชุด',
        calculatedUnitCost: 1.2,
        calculatedLineCost: 1.2,
      },
    ],
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const makePortion = (overrides?: Partial<RiceNoodlePortion>): RiceNoodlePortion => ({
    id: 'portion_rice',
    name: 'ข้าวสวยหอมมะลิ',
    nameEn: 'Jasmine Rice',
    type: 'ข้าว',
    typeEn: 'Rice',
    rawIngredientName: 'ข้าวสารหอมมะลิ',
    rawIngredientNameEn: 'Raw Jasmine Rice',
    rawPurchaseCost: '40 บาท / กก.',
    rawPurchaseCostEn: '40 THB / kg',
    cookingYield: 'Yield 220%',
    cookingYieldEn: 'Yield 220%',
    portionGram: 200,
    yieldPercent: 220,
    costPerPortion: 8.67,
    dishesUsing: [],
    dishesUsingEn: [],
    active: true,
    ...overrides,
  });

  it('derives packagingItems and rounded packagingCost from base recipe items', () => {
    const base = makeBaseRecipe();
    const { packagingCost, packagingItems } = derivePackagingFromBaseRecipe(base);
    expect(packagingItems).toHaveLength(2);
    expect(packagingCost).toBe(3.7);
  });

  it('applies base recipe to variant while preserving multi-protein items', () => {
    const shrimpItem: RecipeItem = {
      id: 'primary_1_shrimp',
      type: 'INGREDIENT',
      ingredientType: 'INGREDIENT',
      ingredientId: 'ing_shrimp',
      name: 'กุ้งสด',
      quantity: 60,
      unit: 'g',
      proteinCategory: 'SHRIMP',
      calculatedUnitCost: 0.35,
      calculatedLineCost: 21,
    };
    const squidItem: RecipeItem = {
      id: 'primary_2_squid',
      type: 'INGREDIENT',
      ingredientType: 'INGREDIENT',
      ingredientId: 'ing_squid',
      name: 'ปลาหมึก',
      quantity: 50,
      unit: 'g',
      proteinCategory: 'SQUID',
      calculatedUnitCost: 0.25,
      calculatedLineCost: 12.5,
    };
    const oldSauce: RecipeItem = {
      id: 'old_sauce',
      type: 'SAUCE',
      ingredientType: 'SAUCE',
      ingredientId: 'sauce_old',
      name: 'ซอสเก่า',
      quantity: 20,
      unit: 'g',
      calculatedUnitCost: 0.1,
      calculatedLineCost: 2,
    };
    const variant: MenuVariant = {
      ...makeVariant('var_seafood', 'menu_1'),
      proteinType: 'ทะเล',
      recipeItems: [shrimpItem, squidItem, oldSauce],
    };

    const updated = applyBaseRecipeToVariant(variant, makeBaseRecipe());
    expect(updated.baseRecipeId).toBe('base_kaprao');
    expect(updated.recipeItems.map((r) => r.ingredientId)).toEqual([
      'ing_shrimp',
      'ing_squid',
      'sauce_1',
      'pkg_kraft',
      'pkg_cutlery',
    ]);
    expect(updated.packagingCost).toBe(3.7);
    expect(updated.packagingItems).toHaveLength(2);
  });

  it('syncs updated base recipe only to linked variants across menus', () => {
    const linkedVariant: MenuVariant = {
      ...makeVariant('v1', 'm1'),
      baseRecipeId: 'base_kaprao',
      recipeItems: [
        {
          id: 'primary_1_pork',
          type: 'INGREDIENT',
          ingredientId: 'ing_pork',
          name: 'หมูสับ',
          quantity: 80,
          unit: 'g',
          proteinCategory: 'PORK',
        },
      ],
    };
    const unlinkedVariant: MenuVariant = {
      ...makeVariant('v2', 'm1'),
      baseRecipeId: 'other_base',
      recipeItems: [
        {
          id: 'keep_me',
          type: 'SAUCE',
          ingredientId: 'sauce_other',
          name: 'ซอสอื่น',
          quantity: 15,
          unit: 'g',
        },
      ],
    };

    const menus: MenuItem[] = [
      makeMenu('m1', 'เมนู 1', [linkedVariant, unlinkedVariant]),
      makeMenu('m2', 'เมนู 2', [makeVariant('v3', 'm2')]),
    ];

    const { updatedMenus, changedMenus, linkedCount } = syncBaseRecipeToLinkedMenus(
      menus,
      makeBaseRecipe()
    );
    expect(linkedCount).toBe(1);
    expect(changedMenus).toHaveLength(1);
    expect(changedMenus[0].id).toBe('m1');
    expect(updatedMenus[0].variants[0].recipeItems.map((i) => i.ingredientId)).toEqual([
      'ing_pork',
      'sauce_1',
      'pkg_kraft',
      'pkg_cutlery',
    ]);
    expect(updatedMenus[0].variants[1].recipeItems.map((i) => i.ingredientId)).toEqual([
      'sauce_other',
    ]);
    expect(updatedMenus[1]).toBe(menus[1]);
  });

  it('detaches deleted baseRecipeId while keeping variant recipe items intact', () => {
    const linkedVariant: MenuVariant = {
      ...makeVariant('v1', 'm1'),
      baseRecipeId: 'base_kaprao',
      recipeItems: [
        {
          id: 's1',
          type: 'SAUCE',
          ingredientId: 'sauce_1',
          name: 'ซอสกะเพรา',
          quantity: 30,
          unit: 'g',
        },
      ],
    };
    const menus: MenuItem[] = [makeMenu('m1', 'เมนู 1', [linkedVariant])];

    const { updatedMenus, changedMenus } = detachBaseRecipeFromMenus(menus, 'base_kaprao');
    expect(changedMenus).toHaveLength(1);
    expect(updatedMenus[0].variants[0].baseRecipeId).toBeUndefined();
    expect(updatedMenus[0].variants[0].recipeItems).toHaveLength(1);
  });

  it('provides non-empty active INITIAL_RICE_NOODLE_PORTIONS records', () => {
    expect(INITIAL_RICE_NOODLE_PORTIONS.length).toBeGreaterThanOrEqual(5);
    for (const p of INITIAL_RICE_NOODLE_PORTIONS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.active).toBe(true);
      expect(p.portionGram).toBeGreaterThan(0);
      expect(p.costPerPortion).toBeGreaterThan(0);
      expect(p.yieldPercent).toBeGreaterThan(0);
    }
  });

  it('builds RICE_NOODLE recipe item from portion and computes scaled & fallback costs', () => {
    const linkedPortion = makePortion({
      id: 'portion_rice',
      linkedIngredientId: 'ing_cooked_rice',
      portionGram: 200,
      costPerPortion: 10,
    });
    const customPortion = makePortion({
      id: 'portion_flat',
      name: 'เส้นใหญ่',
      portionGram: 150,
      costPerPortion: 6,
      linkedIngredientId: undefined,
    });

    const builtLinked = buildRecipeItemFromRiceNoodlePortion(linkedPortion, 100, 'rn_fixed');
    expect(builtLinked.id).toBe('rn_fixed');
    expect(builtLinked.type).toBe('RICE_NOODLE');
    expect(builtLinked.ingredientType).toBe('RICE_NOODLE');
    expect(builtLinked.ingredientId).toBe('ing_cooked_rice');
    expect(builtLinked.riceNoodlePortionId).toBe('portion_rice');
    expect(builtLinked.quantity).toBe(100);
    expect(builtLinked.unit).toBe('g');
    expect(builtLinked.calculatedUnitCost).toBeCloseTo(0.05, 6);
    expect(builtLinked.calculatedLineCost).toBe(5);
    expect(isRiceNoodleRecipeItem(builtLinked)).toBe(true);

    const builtCustom = buildRecipeItemFromRiceNoodlePortion(customPortion);
    expect(builtCustom.ingredientId).toBe('portion_flat');
    expect(builtCustom.quantity).toBe(150);
    expect(builtCustom.calculatedLineCost).toBe(6);

    const portionsMap = new Map<string, RiceNoodlePortion>([
      [linkedPortion.id, linkedPortion],
      [customPortion.id, customPortion],
    ]);

    const liveScaled = computeRiceNoodleRecipeItemCost(builtLinked, portionsMap);
    expect(liveScaled.lineCost).toBe(5);
    expect(liveScaled.missingPrice).toBe(false);

    const servingUnitItem: RecipeItem = { ...builtCustom, quantity: 2, unit: 'เสิร์ฟ' };
    const servingCost = computeRiceNoodleRecipeItemCost(servingUnitItem, portionsMap);
    expect(servingCost.unitCost).toBe(6);
    expect(servingCost.lineCost).toBe(12);

    const fallbackCost = computeRiceNoodleRecipeItemCost(builtLinked, new Map());
    expect(fallbackCost.unitCost).toBeCloseTo(0.05, 6);
    expect(fallbackCost.lineCost).toBe(5);
    expect(fallbackCost.missingPrice).toBe(false);
  });

  it('syncs updated RiceNoodlePortion to linked CentralBaseRecipe items without touching unlinked recipes', () => {
    const initialPortion = makePortion({ id: 'portion_rice', portionGram: 200, costPerPortion: 8 });
    const rnItem = buildRecipeItemFromRiceNoodlePortion(initialPortion, 200, 'rn_1');

    const baseWithRn: CentralBaseRecipe = {
      ...makeBaseRecipe(),
      riceNoodlePortionId: 'portion_rice',
      items: [rnItem, ...makeBaseRecipe().items],
    };
    const otherBase: CentralBaseRecipe = {
      ...makeBaseRecipe(),
      id: 'base_other',
    };

    const updatedPortion = makePortion({
      id: 'portion_rice',
      name: 'ข้าวสวยหอมมะลิ (คัดพิเศษ)',
      portionGram: 200,
      costPerPortion: 12,
      linkedIngredientId: 'ing_rice_new',
    });

    const { updatedBaseRecipes, changedBaseRecipes } = syncRiceNoodlePortionToBaseRecipes(
      [baseWithRn, otherBase],
      updatedPortion
    );
    expect(changedBaseRecipes).toHaveLength(1);
    expect(changedBaseRecipes[0].id).toBe('base_kaprao');
    expect(updatedBaseRecipes[0].items[0].name).toBe('ข้าวสวยหอมมะลิ (คัดพิเศษ)');
    expect(updatedBaseRecipes[0].items[0].ingredientId).toBe('ing_rice_new');
    expect(updatedBaseRecipes[0].items[0].calculatedLineCost).toBe(12);
    expect(updatedBaseRecipes[1]).toBe(otherBase);
  });

  it('carries RICE_NOODLE items cleanly into variants and calculates variant cost breakdown without missing ingredient error', () => {
    const customPortion = makePortion({
      id: 'portion_flat',
      name: 'เส้นใหญ่',
      portionGram: 150,
      costPerPortion: 7.5,
      linkedIngredientId: undefined,
    });
    const rnItem = buildRecipeItemFromRiceNoodlePortion(customPortion, 150, 'rn_item');

    const baseRecipe: CentralBaseRecipe = {
      ...makeBaseRecipe(),
      riceNoodlePortionId: 'portion_flat',
      items: [rnItem],
    };

    const porkProtein: RecipeItem = {
      id: 'primary_1_pork',
      type: 'INGREDIENT',
      ingredientType: 'INGREDIENT',
      ingredientId: 'ing_pork',
      name: 'หมูสับ',
      quantity: 100,
      unit: 'g',
      proteinCategory: 'PORK',
    };
    const staleRnItem: RecipeItem = {
      ...rnItem,
      id: 'old_rn',
      name: 'เส้นเก่า',
    };

    const variant = applyBaseRecipeToVariant(
      {
        ...makeVariant('v_noodle', 'm_noodle'),
        recipeItems: [porkProtein, staleRnItem],
      },
      baseRecipe
    );

    // RICE_NOODLE must not be treated as a protein item (so old_rn was replaced, not duplicated)
    expect(variant.recipeItems).toHaveLength(2);
    expect(variant.recipeItems.map((it) => it.id)).toEqual(['primary_1_pork', 'rn_item']);

    const ingredientsMap = new Map<string, Ingredient>([
      [
        'ing_pork',
        {
          id: 'ing_pork',
          name: 'หมูสับ',
          category: 'เนื้อสัตว์และอาหารทะเล',
          purchaseQuantity: 1000,
          purchaseUnit: 'g',
          purchasePrice: 120,
          actualQuantity: 1000,
          actualUnit: 'g',
          yieldPercent: 100,
          actualCost: 120,
          baseUnit: 'g',
          costPerBaseUnit: 0.12,
          usageUnit: 'g',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);
    const saucesMap = new Map<string, Sauce>();
    const portionsMap = new Map<string, RiceNoodlePortion>([[customPortion.id, customPortion]]);

    const breakdown = calculateVariantCostBreakdown(
      variant,
      'ก๋วยเตี๋ยวคั่วหมูสับ',
      ingredientsMap,
      saucesMap,
      INITIAL_SETTINGS,
      'grab',
      portionsMap
    );

    expect(breakdown.hasReviewIssue).toBe(false);
    expect(breakdown.hasMissingPrice).toBe(false);
    expect(breakdown.meatCost).toBeCloseTo(12, 2);
    expect(breakdown.centralIngredientCost).toBeCloseTo(7.5, 2);
    expect(breakdown.totalIngredientCost).toBeCloseTo(19.5, 2);
  });
});


