import { describe, it, expect } from 'vitest';
import {
  resolveCentralRecipeMenuTarget,
  getCentralRecipeOriginLabel,
  CENTRAL_RECIPE_BUTTON_LABELS,
} from '../../costing/utils/centralRecipeNav';
import { MenuItem, MenuVariant } from '../../costing/types';

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
