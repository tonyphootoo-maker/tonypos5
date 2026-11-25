import {
  CentralBaseRecipe,
  MenuItem,
  MenuVariant,
  PackagingLineItem,
  RecipeItem,
  RiceNoodlePortion,
} from '../types';

export type CentralRecipeOriginPage =
  | 'pos'
  | 'menu_cost'
  | 'cost_food_cost'
  | 'cost_food_cost_alacarte';

export interface CentralRecipeTarget {
  variantId?: string;
  menuId?: string;
  origin: CentralRecipeOriginPage;
  nonce: number;
}

export const CENTRAL_RECIPE_BUTTON_LABELS = {
  openTh: 'เปิดสูตรกลางของเมนูนี้',
  openEn: 'Open Central Recipe',
  saveAndOpenTh: 'บันทึกแล้วไปที่สูตรกลาง',
  saveAndOpenEn: 'Save & Open Central Recipe',
  goWithoutSavingTh: 'ไปโดยไม่บันทึก',
  goWithoutSavingEn: 'Leave Without Saving',
  stayTh: 'อยู่ต่อ',
  stayEn: 'Stay Here',
  unresolvedHintTh:
    'ยังไม่พบสูตรกลางที่เชื่อมกับตัวเลือกนี้ กรุณาเชื่อมข้อมูลจากต้นทุนอาหารก่อน',
  unresolvedHintEn:
    'No central recipe linked to this option yet. Please link it from Food Cost first.',
} as const;

export function getCentralRecipeOriginLabel(
  origin: CentralRecipeOriginPage | null | undefined,
  lang: 'th' | 'en' = 'th'
): string {
  switch (origin) {
    case 'menu_cost':
      return lang === 'en' ? 'Menu Management' : 'จัดการเมนู';
    case 'pos':
      return lang === 'en' ? 'Tables / POS' : 'โต๊ะ / จุดขาย (POS)';
    case 'cost_food_cost_alacarte':
      return lang === 'en'
        ? 'Food Cost / Menu (A La Carte)'
        : 'ต้นทุนอาหาร / เมนู (กับข้าว)';
    case 'cost_food_cost':
      return lang === 'en' ? 'Food Cost / Menu' : 'ต้นทุนอาหาร / เมนู';
    default:
      return '';
  }
}

/**
 * Resolve an active central MenuItem (and optional active MenuVariant) from a navigation target.
 * Prefers matching `variantId` on an active variant inside an active menu, then falls back to `menuId`.
 */
export function resolveCentralRecipeMenuTarget(
  menus: MenuItem[],
  target: { variantId?: string; menuId?: string } | null | undefined
): { menu: MenuItem; variant?: MenuVariant } | null {
  if (!target || !Array.isArray(menus) || menus.length === 0) return null;

  const activeMenus = menus.filter((m) => m.active !== false);

  if (target.variantId) {
    for (const m of activeMenus) {
      const matchedVar = (m.variants || []).find(
        (v) => v.id === target.variantId && v.active !== false
      );
      if (matchedVar) {
        return { menu: m, variant: matchedVar };
      }
    }
  }

  if (target.menuId) {
    const matchedMenu = activeMenus.find((m) => m.id === target.menuId);
    if (matchedMenu) {
      return { menu: matchedMenu };
    }
  }

  return null;
}

export function isVariantProteinRecipeItem(it: RecipeItem, proteinType?: string): boolean {
  if (
    it.proteinCategory === 'SHRIMP' ||
    it.proteinCategory === 'SQUID' ||
    it.proteinCategory === 'PORK' ||
    it.proteinCategory === 'CHICKEN' ||
    it.proteinCategory === 'BEEF' ||
    it.proteinCategory === 'OTHER' ||
    it.id?.startsWith('primary_1_') ||
    it.id?.startsWith('primary_2_')
  ) {
    return true;
  }

  if (
    it.type === 'SAUCE' ||
    it.ingredientType === 'SAUCE' ||
    it.type === 'PACKAGING' ||
    it.ingredientType === 'PACKAGING' ||
    it.type === 'PREPARED_ITEM' ||
    it.ingredientType === 'PREPARED_ITEM' ||
    it.type === 'RICE_NOODLE' ||
    it.ingredientType === 'RICE_NOODLE' ||
    Boolean(it.riceNoodlePortionId)
  ) {
    return false;
  }

  const name = (it.name || '').trim().toLowerCase();
  if (
    name.includes('น้ำปลา') ||
    name.includes('น้ำมัน') ||
    name.includes('ซอส') ||
    name.includes('ผง') ||
    name.includes('ซีอิ๊ว') ||
    name.includes('กะปิ') ||
    name.includes('กุ้งแห้ง') ||
    name.includes('ใบ') ||
    name.includes('พริก') ||
    name.includes('กระเทียม') ||
    name.includes('หอม') ||
    name.includes('ไข่') ||
    name.includes('ผัก') ||
    name.includes('น้ำตาล') ||
    name.includes('เกลือ') ||
    name.includes('ข้าว')
  ) {
    return false;
  }

  if (
    name.includes('หมู') ||
    name.includes('ไก่') ||
    name.includes('เนื้อ') ||
    name.includes('กุ้ง') ||
    name.includes('หมึก') ||
    name.includes('ไส้กรอก') ||
    name.includes('ปลา') ||
    name.includes('ทะเล') ||
    name.includes('ซีฟู้ด')
  ) {
    return true;
  }

  if (proteinType && proteinType.trim()) {
    const pType = proteinType.trim().toLowerCase();
    if (name === pType || name.startsWith(pType)) {
      return true;
    }
  }

  return false;
}

export function derivePackagingFromBaseRecipe(baseRecipe: CentralBaseRecipe): {
  packagingCost: number;
  packagingItems: PackagingLineItem[];
} {
  const pkgFromItems: PackagingLineItem[] = (baseRecipe.items || [])
    .filter((it) => it.type === 'PACKAGING' || it.ingredientType === 'PACKAGING')
    .map((it, idx) => ({
      id: it.id || `pkg_${idx}_${it.ingredientId}`,
      name: it.name,
      cost:
        typeof it.calculatedLineCost === 'number'
          ? it.calculatedLineCost
          : (Number(it.quantity) || 0) * (Number(it.calculatedUnitCost) || 0),
    }));

  const packagingItems =
    pkgFromItems.length > 0
      ? pkgFromItems
      : (baseRecipe.packagingItems || []).map((p) => ({ ...p }));

  const packagingCost =
    packagingItems.length > 0
      ? Number(packagingItems.reduce((sum, p) => sum + (Number(p.cost) || 0), 0).toFixed(2))
      : Number(baseRecipe.packagingCost) || 0;

  return { packagingCost, packagingItems };
}

export function applyBaseRecipeToVariant(
  variant: MenuVariant,
  baseRecipe: CentralBaseRecipe
): MenuVariant {
  const proteinItems = (variant.recipeItems || []).filter((it) =>
    isVariantProteinRecipeItem(it, variant.proteinType)
  );
  const clonedBaseItems = (baseRecipe.items || []).map((it) => ({ ...it }));
  const { packagingCost, packagingItems } = derivePackagingFromBaseRecipe(baseRecipe);

  const seenIds = new Set<string>();
  const combinedRecipeItems: RecipeItem[] = [];
  for (const item of [...proteinItems, ...clonedBaseItems]) {
    let safeId = item.id || `item_${combinedRecipeItems.length}_${item.ingredientId}`;
    if (seenIds.has(safeId)) {
      safeId = `${safeId}_${combinedRecipeItems.length}`;
    }
    seenIds.add(safeId);
    combinedRecipeItems.push({ ...item, id: safeId });
  }

  return {
    ...variant,
    baseRecipeId: baseRecipe.id,
    recipeItems: combinedRecipeItems,
    packagingCost:
      packagingItems.length > 0 ? packagingCost : variant.packagingCost,
    packagingItems:
      packagingItems.length > 0 ? packagingItems : variant.packagingItems,
  };
}

export function syncBaseRecipeToLinkedMenus(
  menus: MenuItem[],
  baseRecipe: CentralBaseRecipe
): { updatedMenus: MenuItem[]; changedMenus: MenuItem[]; linkedCount: number } {
  const changedMenus: MenuItem[] = [];
  let linkedCount = 0;

  const updatedMenus = menus.map((menu) => {
    let menuChanged = false;
    const nextVariants = (menu.variants || []).map((variant) => {
      if (variant.baseRecipeId !== baseRecipe.id) {
        return variant;
      }
      menuChanged = true;
      linkedCount += 1;
      return applyBaseRecipeToVariant(variant, baseRecipe);
    });
    if (!menuChanged) return menu;
    const updatedMenu: MenuItem = {
      ...menu,
      variants: nextVariants,
      updatedAt: new Date().toISOString(),
    };
    changedMenus.push(updatedMenu);
    return updatedMenu;
  });

  return { updatedMenus, changedMenus, linkedCount };
}

export function detachBaseRecipeFromMenus(
  menus: MenuItem[],
  baseRecipeId: string
): { updatedMenus: MenuItem[]; changedMenus: MenuItem[] } {
  const changedMenus: MenuItem[] = [];
  const updatedMenus = menus.map((menu) => {
    let menuChanged = false;
    const nextVariants = (menu.variants || []).map((variant) => {
      if (variant.baseRecipeId !== baseRecipeId) {
        return variant;
      }
      menuChanged = true;
      const copy = { ...variant };
      delete copy.baseRecipeId;
      return copy;
    });
    if (!menuChanged) return menu;
    const updatedMenu: MenuItem = {
      ...menu,
      variants: nextVariants,
      updatedAt: new Date().toISOString(),
    };
    changedMenus.push(updatedMenu);
    return updatedMenu;
  });
  return { updatedMenus, changedMenus };
}

export function isRiceNoodleRecipeItem(it: RecipeItem): boolean {
  return (
    it.type === 'RICE_NOODLE' ||
    it.ingredientType === 'RICE_NOODLE' ||
    Boolean(it.riceNoodlePortionId)
  );
}

export function buildRecipeItemFromRiceNoodlePortion(
  portion: RiceNoodlePortion,
  quantityInGrams?: number,
  existingId?: string
): RecipeItem {
  const portionGram = Number(portion.portionGram) > 0 ? Number(portion.portionGram) : 100;
  const qty =
    quantityInGrams !== undefined && Number.isFinite(quantityInGrams) && quantityInGrams > 0
      ? quantityInGrams
      : portionGram;
  const unitCostPerGram = portionGram > 0 ? (Number(portion.costPerPortion) || 0) / portionGram : 0;
  const lineCost = Number((qty * unitCostPerGram).toFixed(2));

  return {
    id: existingId || `base_rn_${portion.id}_${Date.now()}`,
    type: 'RICE_NOODLE',
    ingredientType: 'RICE_NOODLE',
    ingredientId: portion.linkedIngredientId || portion.id,
    riceNoodlePortionId: portion.id,
    name: portion.name,
    quantity: qty,
    unit: 'g',
    calculatedUnitCost: Number(unitCostPerGram.toFixed(6)),
    calculatedLineCost: lineCost,
  };
}

export function computeRiceNoodleRecipeItemCost(
  item: RecipeItem,
  portionsMap?: Map<string, RiceNoodlePortion>
): {
  unitCost: number;
  lineCost: number;
  portion?: RiceNoodlePortion;
  missingPrice: boolean;
} {
  const qty = Number(item.quantity) || 0;
  const portion = item.riceNoodlePortionId ? portionsMap?.get(item.riceNoodlePortionId) : undefined;
  const isServingUnit =
    item.unit === 'เสิร์ฟ' ||
    item.unit === 'จาน' ||
    item.unit === 'portion' ||
    item.unit === 'serving' ||
    item.unit === 'ซอง' ||
    item.unit === 'แพ็ค';

  if (portion) {
    const portionCost = Number(portion.costPerPortion) || 0;
    const portionGram = Number(portion.portionGram) > 0 ? Number(portion.portionGram) : 100;
    const unitCost = isServingUnit ? portionCost : portionCost / portionGram;
    const lineCost = Number((qty * unitCost).toFixed(2));
    return {
      unitCost,
      lineCost,
      portion,
      missingPrice: portionCost <= 0,
    };
  }

  const fallbackUnit = Number(item.calculatedUnitCost) || 0;
  const fallbackLine =
    fallbackUnit > 0
      ? Number((qty * fallbackUnit).toFixed(2))
      : Number(item.calculatedLineCost) || 0;
  return {
    unitCost: fallbackUnit,
    lineCost: fallbackLine,
    missingPrice: fallbackUnit <= 0 && fallbackLine <= 0,
  };
}

export function syncRiceNoodlePortionToBaseRecipes(
  baseRecipes: CentralBaseRecipe[],
  portion: RiceNoodlePortion
): { updatedBaseRecipes: CentralBaseRecipe[]; changedBaseRecipes: CentralBaseRecipe[] } {
  const changedBaseRecipes: CentralBaseRecipe[] = [];
  const portionGram = Number(portion.portionGram) > 0 ? Number(portion.portionGram) : 100;
  const unitCostPerGram = Number(((Number(portion.costPerPortion) || 0) / portionGram).toFixed(6));

  const updatedBaseRecipes = baseRecipes.map((recipe) => {
    let changed = false;
    const nextItems = (recipe.items || []).map((it) => {
      if (it.riceNoodlePortionId !== portion.id) return it;
      changed = true;
      const qty = Number(it.quantity) > 0 ? Number(it.quantity) : portionGram;
      const isServingUnit =
        it.unit === 'เสิร์ฟ' ||
        it.unit === 'จาน' ||
        it.unit === 'portion' ||
        it.unit === 'serving' ||
        it.unit === 'ซอง' ||
        it.unit === 'แพ็ค';
      const unitCost = isServingUnit ? Number(portion.costPerPortion) || 0 : unitCostPerGram;
      return {
        ...it,
        type: 'RICE_NOODLE' as const,
        ingredientType: 'RICE_NOODLE' as const,
        ingredientId: portion.linkedIngredientId || portion.id,
        name: portion.name,
        quantity: qty,
        calculatedUnitCost: unitCost,
        calculatedLineCost: Number((qty * unitCost).toFixed(2)),
      };
    });

    if (!changed) return recipe;
    const updatedRecipe: CentralBaseRecipe = {
      ...recipe,
      items: nextItems,
      updatedAt: new Date().toISOString(),
    };
    changedBaseRecipes.push(updatedRecipe);
    return updatedRecipe;
  });

  return { updatedBaseRecipes, changedBaseRecipes };
}
