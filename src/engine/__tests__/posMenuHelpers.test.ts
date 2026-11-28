import { describe, it, expect } from 'vitest';
import {
  isPosOwnedCategory,
  filterPosOwnedCategories,
  resolveSafePosCategoryId,
  getUnifiedCostMenuCategoryValue,
  getPosCategoryLabel,
  resolveUnifiedPosCategory,
  doesCostMenuMatchPosCategory,
  moveDishToCategoryList,
  buildInitialOptionSelections,
} from '../posMenuHelpers';
import { CategoryDoc, DishDoc, OptionChoice } from '../../types';

const makeCategory = (
  id: string,
  name: string,
  order: number,
  nameTh?: string
): CategoryDoc => ({
  id,
  name,
  nameTh: nameTh ?? name,
  order,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
});

const makeDish = (id: string, categoryId: string, order: number, version = 1): DishDoc => ({
  id,
  name: id,
  nameTh: id,
  categoryId,
  variants: [
    {
      id: `var_${id}`,
      name: 'Standard',
      nameTh: 'มาตรฐาน',
      price: 60,
      ingredients: [],
      subRecipes: [],
      packaging: [],
    },
  ],
  optionGroupIds: [],
  order,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version,
});

describe('posMenuHelpers', () => {
  describe('POS-owned category filtering', () => {
    it('keeps POS-created categories and excludes foreign cat_cost_* categories', () => {
      const categories: CategoryDoc[] = [
        makeCategory('cat_main', 'Main Dishes', 1),
        makeCategory('cat_cost_rice', 'Costing Rice', 2),
        makeCategory('cat_1700000123', 'Drinks', 3),
        makeCategory('cat_cost_noodles', 'Costing Noodles', 4),
        makeCategory('cat_dessert', 'Dessert', 5),
      ];

      expect(isPosOwnedCategory({ id: 'cat_main' })).toBe(true);
      expect(isPosOwnedCategory({ id: 'cat_1700000123' })).toBe(true);
      expect(isPosOwnedCategory({ id: 'cat_cost_rice' })).toBe(false);
      expect(isPosOwnedCategory(null)).toBe(false);
      expect(isPosOwnedCategory({ id: '' })).toBe(false);

      const filtered = filterPosOwnedCategories(categories);
      expect(filtered.map((c) => c.id)).toEqual([
        'cat_main',
        'cat_1700000123',
        'cat_dessert',
      ]);
    });

    it('resolves safe POS categoryId when stored categoryId is foreign or missing', () => {
      const posCategories: CategoryDoc[] = [
        makeCategory('cat_app', 'Appetizers', 1),
        makeCategory('cat_main', 'Main', 2),
        makeCategory('cat_cost_temp', 'Cost Temp', 3),
      ];

      expect(resolveSafePosCategoryId('cat_main', posCategories)).toBe('cat_main');
      expect(resolveSafePosCategoryId('cat_cost_temp', posCategories)).toBe('cat_app');
      expect(resolveSafePosCategoryId('cat_unknown', posCategories)).toBe('cat_app');
      expect(resolveSafePosCategoryId(undefined, [])).toBe('cat_main');
    });
  });

  describe('Unified POS / Costing category resolution', () => {
    const unifiedCats: CategoryDoc[] = [
      makeCategory('cat_main', 'Main Dishes', 1, 'อาหารจานหลัก'),
      makeCategory('cat_app', 'Appetizers', 2, 'ของทานเล่น'),
      makeCategory('cat_drink', 'Drinks', 3, 'เครื่องดื่ม'),
      makeCategory('cat_dessert', 'Desserts', 4, 'ของหวาน'),
      makeCategory('cat_cost_legacy', 'Legacy', 5, 'Legacy'),
    ];

    it('formats unified category values and localized labels cleanly', () => {
      expect(getUnifiedCostMenuCategoryValue(unifiedCats[0])).toBe('อาหารจานหลัก');
      expect(getPosCategoryLabel(unifiedCats[0], 'th')).toBe('อาหารจานหลัก');
      expect(getPosCategoryLabel(unifiedCats[0], 'en')).toBe('Main Dishes');
    });

    it('resolves IDs, exact TH/EN names, and legacy Costing categories to unified POS categories', () => {
      expect(resolveUnifiedPosCategory('cat_drink', unifiedCats)?.id).toBe('cat_drink');
      expect(resolveUnifiedPosCategory('อาหารจานหลัก', unifiedCats)?.id).toBe('cat_main');
      expect(resolveUnifiedPosCategory('Appetizers', unifiedCats)?.id).toBe('cat_app');
      expect(resolveUnifiedPosCategory('จานด่วน / ตามสั่ง', unifiedCats)?.id).toBe('cat_main');
      expect(resolveUnifiedPosCategory('เส้นและก๋วยเตี๋ยว', unifiedCats)?.id).toBe('cat_main');
      expect(resolveUnifiedPosCategory('ชุดเครื่องเคียง', unifiedCats)?.id).toBe('cat_app');
      expect(resolveUnifiedPosCategory('กาแฟและชา', unifiedCats)?.id).toBe('cat_drink');
      expect(resolveUnifiedPosCategory('ขนมไทย', unifiedCats)?.id).toBe('cat_dessert');
      expect(resolveUnifiedPosCategory('cat_cost_legacy', unifiedCats)?.id).toBe('cat_main');
    });

    it('matches Costing menu items accurately against unified POS categories', () => {
      expect(doesCostMenuMatchPosCategory('จานด่วน / ตามสั่ง', unifiedCats[0], unifiedCats)).toBe(true);
      expect(doesCostMenuMatchPosCategory('ชุดเครื่องเคียง', unifiedCats[1], unifiedCats)).toBe(true);
      expect(doesCostMenuMatchPosCategory('เครื่องดื่ม', unifiedCats[2], unifiedCats)).toBe(true);
      expect(doesCostMenuMatchPosCategory('อาหารจานหลัก', unifiedCats[2], unifiedCats)).toBe(false);
    });
  });

  describe('moveDishToCategoryList (cross-category dish drag-and-drop)', () => {
    it('moves a dish to targetCategoryId, updates order/version, and updates categoryId cleanly', () => {
      const dishes: DishDoc[] = [
        makeDish('d1', 'cat_main', 1, 2),
        makeDish('d2', 'cat_main', 2, 1),
        makeDish('d3', 'cat_drink', 3, 1),
      ];

      const result = moveDishToCategoryList({
        dishes,
        dishId: 'd1',
        targetCategoryId: 'cat_drink',
        nowIso: '2026-05-01T10:00:00.000Z',
      });

      expect(result.changed).toBe(true);
      expect(result.updatedDish?.categoryId).toBe('cat_drink');
      expect(result.updatedDish?.version).toBe(3);
      expect(result.updatedDish?.updatedAt).toBe('2026-05-01T10:00:00.000Z');
      expect(result.updatedDish?.order).toBeGreaterThan(3);

      const movedInList = result.nextDishes.find((d) => d.id === 'd1');
      expect(movedInList?.categoryId).toBe('cat_drink');
    });

    it('returns changed: false when dropping into the same category or missing dish', () => {
      const dishes: DishDoc[] = [makeDish('d1', 'cat_main', 1)];

      const sameCat = moveDishToCategoryList({
        dishes,
        dishId: 'd1',
        targetCategoryId: 'cat_main',
      });
      expect(sameCat.changed).toBe(false);
      expect(sameCat.updatedDish).toBeNull();

      const missingDish = moveDishToCategoryList({
        dishes,
        dishId: 'nonexistent',
        targetCategoryId: 'cat_drink',
      });
      expect(missingDish.changed).toBe(false);
    });
  });

  describe('buildInitialOptionSelections (no pre-selected add-on options)', () => {
    const choiceA: OptionChoice = { id: 'c1', name: 'Fried Egg', price: 10 };
    const choiceB: OptionChoice = { id: 'c2', name: 'Omelet', price: 15, hasQuantity: true };
    const optionGroupMap = new Map<string, { choices: OptionChoice[] }>([
      ['grp_required', { choices: [choiceA, choiceB] }],
      ['grp_optional', { choices: [choiceA] }],
    ]);

    it('returns completely empty selections by default even when option groups exist', () => {
      const init = buildInitialOptionSelections({
        optionGroupIds: ['grp_required', 'grp_optional'],
        optionGroupMap,
      });

      expect(init).toEqual({});
    });

    it('restores explicit saved favorite selections only when provided', () => {
      const init = buildInitialOptionSelections({
        optionGroupIds: ['grp_required', 'grp_optional'],
        optionGroupMap,
        savedSelections: {
          grp_required: { c2: 2 },
        },
      });

      expect(init).toEqual({
        grp_required: { c2: 2 },
      });
    });
  });
});
