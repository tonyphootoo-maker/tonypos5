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
