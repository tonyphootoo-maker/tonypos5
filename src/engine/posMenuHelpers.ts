import { CategoryDoc, DishDoc, OptionChoice } from '../types';
import { getOptionChoiceEffectiveQuantity, isOptionChoiceQuantityEnabled } from './calculations';

/**
 * Returns true only for categories created/managed within this POS application,
 * filtering out foreign categories injected by external/costing app bridges (cat_cost_*).
 */
export function isPosOwnedCategory(
  cat: Pick<CategoryDoc, 'id'> | null | undefined
): boolean {
  if (!cat || typeof cat.id !== 'string' || !cat.id.trim()) return false;
  return !cat.id.startsWith('cat_cost_');
}

export function filterPosOwnedCategories(categories: CategoryDoc[]): CategoryDoc[] {
  return (categories || []).filter(isPosOwnedCategory);
}

/**
 * Ensures a categoryId resolves to a valid POS-owned category.
 * If the stored categoryId belongs to a foreign/removed category, falls back to the first POS category.
 */
export function resolveSafePosCategoryId(
  categoryId: string | null | undefined,
  posCategories: CategoryDoc[],
  fallbackId = 'cat_main'
): string {
  const validPosCats = filterPosOwnedCategories(posCategories);
  if (categoryId && validPosCats.some((c) => c.id === categoryId)) {
    return categoryId;
  }
  return validPosCats[0]?.id || fallbackId;
}

export function getUnifiedCostMenuCategoryValue(cat: Pick<CategoryDoc, 'name' | 'nameTh'>): string {
  return (cat.nameTh || cat.name || '').trim();
}

export function getPosCategoryLabel(
  cat: Pick<CategoryDoc, 'name' | 'nameTh'>,
  lang: 'th' | 'en' = 'th'
): string {
  if (lang === 'en') {
    return (cat.name || cat.nameTh || '').trim();
  }
  return (cat.nameTh || cat.name || '').trim();
}

/**
 * Resolves any category string stored on a Costing MenuItem (id, Thai/English name,
 * or legacy costing category string) to a single unified POS-owned CategoryDoc.
 */
export function resolveUnifiedPosCategory(
  rawCategoryOrId: string | null | undefined,
  posCategories: CategoryDoc[]
): CategoryDoc | null {
  const validPosCats = filterPosOwnedCategories(posCategories);
  if (validPosCats.length === 0) return null;

  const raw = (rawCategoryOrId || '').trim();
  if (raw) {
    // 1. Direct ID match
    const byId = validPosCats.find((c) => c.id === raw);
    if (byId) return byId;

    // 2. Exact Thai or English name match (case-insensitive)
    const lower = raw.toLowerCase();
    const byName = validPosCats.find(
      (c) =>
        (c.name && c.name.trim().toLowerCase() === lower) ||
        (c.nameTh && c.nameTh.trim().toLowerCase() === lower)
    );
    if (byName) return byName;

    // 3. Semantic legacy costing category mapping
    if (/(ของหวาน|ขนม|เค้ก|ไอศกรีม|dessert|sweet)/i.test(lower)) {
      const dessert =
        validPosCats.find((c) => c.id === 'cat_dessert') ||
        validPosCats.find((c) => /(ของหวาน|dessert)/i.test(`${c.name} ${c.nameTh || ''}`));
      if (dessert) return dessert;
    }
    if (/(เครื่องดื่ม|กาแฟ|ชา|น้ำปั่น|น้ำหวาน|beverage|drink)/i.test(lower)) {
      const drink =
        validPosCats.find((c) => c.id === 'cat_drink') ||
        validPosCats.find((c) => /(เครื่องดื่ม|beverage|drink)/i.test(`${c.name} ${c.nameTh || ''}`));
      if (drink) return drink;
    }
    if (/(ทานเล่น|เครื่องเคียง|กับแกล้ม|ของว่าง|สลัด|appetizer|side|snack|starter)/i.test(lower)) {
      const app =
        validPosCats.find((c) => c.id === 'cat_app') ||
        validPosCats.find((c) => /(ทานเล่น|appetizer|snack)/i.test(`${c.name} ${c.nameTh || ''}`));
      if (app) return app;
    }
  }

  return (
    validPosCats.find((c) => c.id === 'cat_main') ||
    validPosCats.find((c) => /(จานหลัก|main)/i.test(`${c.name} ${c.nameTh || ''}`)) ||
    validPosCats[0]
  );
}

export function doesCostMenuMatchPosCategory(
  menuCategory: string | null | undefined,
  targetCat: CategoryDoc,
  posCategories: CategoryDoc[]
): boolean {
  const resolved = resolveUnifiedPosCategory(menuCategory, posCategories);
  return resolved?.id === targetCat.id;
}

/**
 * Moves a dish into another category and updates its categoryId and order cleanly.
 */
export function moveDishToCategoryList(params: {
  dishes: DishDoc[];
  dishId: string;
  targetCategoryId: string;
  nowIso?: string;
}): {
  updatedDish: DishDoc | null;
  nextDishes: DishDoc[];
  changed: boolean;
} {
  const { dishes, dishId, targetCategoryId, nowIso = new Date().toISOString() } = params;
  if (!dishId || !targetCategoryId) {
    return { updatedDish: null, nextDishes: dishes, changed: false };
  }

  const targetDish = dishes.find((d) => d.id === dishId);
  if (!targetDish || targetDish.categoryId === targetCategoryId) {
    return { updatedDish: null, nextDishes: dishes, changed: false };
  }

  const targetCatDishes = dishes.filter(
    (d) => d.categoryId === targetCategoryId && d.id !== dishId
  );
  const maxTargetOrder = targetCatDishes.reduce(
    (max, d) => Math.max(max, Number(d.order) || 0),
    0
  );
  const maxGlobalOrder = dishes.reduce(
    (max, d) => Math.max(max, Number(d.order) || 0),
    dishes.length
  );

  const nextOrder = Math.max(maxTargetOrder + 1, maxGlobalOrder + 1);
  const updatedDish: DishDoc = {
    ...targetDish,
    categoryId: targetCategoryId,
    order: nextOrder,
    updatedAt: nowIso,
    version: (targetDish.version || 0) + 1,
  };

  const nextDishes = dishes
    .map((d) => (d.id === dishId ? updatedDish : d))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return {
    updatedDish,
    nextDishes,
    changed: true,
  };
}

/**
 * Initializes dish add-on option selections cleanly without pre-selecting any choice by default.
 * Only explicit saved presets (e.g., from a user's saved favorite item) populate initial choices.
 */
export function buildInitialOptionSelections(params: {
  optionGroupIds?: string[];
  optionGroupMap: Map<string, { choices: OptionChoice[] }>;
  savedSelections?: Record<string, Record<string, number>>;
}): Record<string, Record<string, number>> {
  const { optionGroupIds = [], optionGroupMap, savedSelections } = params;
  const initOpts: Record<string, Record<string, number>> = {};

  if (!savedSelections) {
    return initOpts;
  }

  for (const gId of optionGroupIds) {
    const grp = optionGroupMap.get(gId);
    const savedGroupMap = savedSelections[gId];
    if (!grp || !savedGroupMap) continue;

    const cleanMap: Record<string, number> = {};
    for (const [cId, rawQty] of Object.entries(savedGroupMap)) {
      const ch = grp.choices.find((c) => c.id === cId);
      if (ch && rawQty > 0) {
        cleanMap[cId] = isOptionChoiceQuantityEnabled(ch)
          ? Math.max(1, Math.round(rawQty))
          : getOptionChoiceEffectiveQuantity(ch) > 1
          ? 1
          : 1;
      }
    }
    if (Object.keys(cleanMap).length > 0) {
      initOpts[gId] = cleanMap;
    }
  }

  return initOpts;
}
