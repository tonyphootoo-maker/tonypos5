import { describe, it, expect } from 'vitest';
import {
  resolveCentralRecipeMenuTarget,
  getCentralRecipeOriginLabel,
  CENTRAL_RECIPE_BUTTON_LABELS,
  derivePackagingFromBaseRecipe,
  applyBaseRecipeToVariant,
  syncBaseRecipeToLinkedMenus,
  detachBaseRecipeFromMenus,
} from '../../costing/utils/centralRecipeNav';
import { INITIAL_RICE_NOODLE_PORTIONS } from '../../costing/data/initialData';
import { CentralBaseRecipe, MenuItem, MenuVariant, RecipeItem } from '../../costing/types';

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
});

