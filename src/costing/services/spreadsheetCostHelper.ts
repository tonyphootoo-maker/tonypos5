import { Ingredient, MenuItem, MenuVariant, RecipeItem } from '../types';
import { DishDoc, DishVariant } from '../../types';
import { resolveEntityEnglishName } from '../../utils/thaiToEnglish';
import { convertUnit } from '../engine/units';

export type SpreadsheetServingMode = 'ON_RICE' | 'A_LA_CARTE';

export function isPrimaryProteinItem(it: RecipeItem, proteinType?: string): boolean {
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
    it.ingredientType === 'PREPARED_ITEM'
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

export function extractPrimaryRecipeItems(v: MenuVariant): {
  isSeafood: boolean;
  shrimpItem?: RecipeItem;
  squidItem?: RecipeItem;
  primary1?: RecipeItem;
  primary2?: RecipeItem;
  allPrimaryItems: RecipeItem[];
} {
  const pName = (v.proteinType || v.name || '').toLowerCase();
  const isSeafood = Boolean(
    v.proteinType?.includes('ทะเล') ||
      pName.includes('ทะเล') ||
      v.proteinType?.includes('ซีฟู้ด') ||
      pName.includes('ซีฟู้ด') ||
      (pName.includes('กุ้ง') && pName.includes('หมึก'))
  );

  const items = v.recipeItems || [];
  const shrimpItem = items.find(
    (it) => it.proteinCategory === 'SHRIMP' || (it.name || '').toLowerCase().includes('กุ้ง')
  );
  const squidItem = items.find(
    (it) =>
      it.proteinCategory === 'SQUID' ||
      (it.name || '').toLowerCase().includes('หมึก') ||
      (it.name || '').toLowerCase().includes('ปลาหมึก')
  );

  let primaryMatches = items.filter((it) => isPrimaryProteinItem(it, v.proteinType));
  if (primaryMatches.length === 0 && items.length > 0) {
    primaryMatches = [items[0]];
  }

  // Respect explicit primary_1_ / primary_2_ slot ordering when present
  const explicit1 = primaryMatches.find((it) => it.id?.startsWith('primary_1_'));
  const explicit2 = primaryMatches.find((it) => it.id?.startsWith('primary_2_'));
  const primary1 = explicit1 || primaryMatches[0];
  const primary2 =
    explicit2 && explicit2 !== primary1
      ? explicit2
      : primaryMatches.find((it) => it !== primary1);

  return {
    isSeafood,
    shrimpItem,
    squidItem,
    primary1,
    primary2,
    allPrimaryItems: primaryMatches,
  };
}

export function computeIngredientUnitCostForRecipeItem(
  item: RecipeItem | undefined,
  ingredientsMap: Map<string, Ingredient>,
  fallbackUnitCost: number = 0
): number {
  if (!item) return fallbackUnitCost;
  const ing = item.ingredientId ? ingredientsMap.get(item.ingredientId) : undefined;
  if (ing) {
    const baseUnitCost =
      ing.costPerBaseUnit ||
      (ing.purchaseQuantity > 0
        ? ing.purchasePrice / (ing.purchaseQuantity * ((ing.yieldPercent || 100) / 100))
        : 0);
    if (baseUnitCost > 0) {
      const targetUnit = ing.usageUnit || ing.baseUnit || item.unit || 'g';
      const itemUnit = item.unit || targetUnit;
      const conv = convertUnit(1, itemUnit, targetUnit);
      return conv.success ? baseUnitCost * conv.convertedQuantity : baseUnitCost;
    }
  }
  return item.calculatedUnitCost || fallbackUnitCost;
}

function normalizePosCostId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || `id_${Date.now()}`;
}

export function resolveCostVariantLabel(v: MenuVariant): string {
  const itemLabel = (v.thaiName || v.name || '').trim();
  if (itemLabel) {
    return itemLabel;
  }
  const p = (v.proteinType || '').trim();
  if (p && p !== 'ทั่วไป' && p !== 'Standard') {
    return p;
  }
  return 'มาตรฐาน';
}

export function resolveCostVariantDisplayNames(
  dish: Pick<DishDoc, 'id' | 'name' | 'nameTh' | 'costMenuId'>,
  variant: Pick<DishVariant, 'id' | 'name' | 'nameTh' | 'costMenuId' | 'costVariantId'>,
  costMenus: MenuItem[] = []
): { name: string; nameTh?: string } {
  if (!costMenus || costMenus.length === 0) {
    return { name: variant.name, ...(variant.nameTh ? { nameTh: variant.nameTh } : {}) };
  }

  let matchedVariant: MenuVariant | undefined;

  const targetMenuId = variant.costMenuId || dish.costMenuId;
  if (targetMenuId) {
    const targetMenu = costMenus.find((m) => m.id === targetMenuId);
    if (targetMenu) {
      matchedVariant = (targetMenu.variants || []).find(
        (cv) =>
          (variant.costVariantId && cv.id === variant.costVariantId) || cv.id === variant.id
      );
    }
  }

  if (!matchedVariant) {
    for (const cm of costMenus) {
      const found = (cm.variants || []).find(
        (cv) =>
          (variant.costVariantId && cv.id === variant.costVariantId) || cv.id === variant.id
      );
      if (found) {
        matchedVariant = found;
        break;
      }
    }
  }

  if (!matchedVariant) {
    const dTh = (dish.nameTh || '').trim().toLowerCase();
    const dEn = (dish.name || '').trim().toLowerCase();
    const matchedMenu =
      (targetMenuId ? costMenus.find((m) => m.id === targetMenuId) : undefined) ||
      (dish.id?.startsWith('cost_dish_')
        ? costMenus.find((m) => `cost_dish_${normalizePosCostId(m.id)}` === dish.id)
        : undefined) ||
      costMenus.find((m) => {
        const mTh = (m.thaiName || m.name || '').trim().toLowerCase();
        const mEn = (m.englishName || '').trim().toLowerCase();
        return (dTh && (mTh === dTh || mEn === dTh)) || (dEn && (mTh === dEn || mEn === dEn));
      });

    if (matchedMenu) {
      const vTh = (variant.nameTh || '').trim().toLowerCase();
      const vEn = (variant.name || '').trim().toLowerCase();
      matchedVariant = (matchedMenu.variants || []).find((cv) => {
        const cvTh = (cv.thaiName || cv.name || '').trim().toLowerCase();
        const cvEn = (cv.englishName || '').trim().toLowerCase();
        const cvProt = (cv.proteinType || '').trim().toLowerCase();
        return (
          (vTh && (cvTh === vTh || cvProt === vTh)) ||
          (vEn && (cvEn === vEn || cvTh === vEn || cvProt === vEn))
        );
      });
    }
  }

  if (matchedVariant) {
    const labelTh = resolveCostVariantLabel(matchedVariant);
    const labelEn =
      resolveEntityEnglishName(labelTh, matchedVariant.englishName) || labelTh;
    return {
      name: labelEn,
      nameTh: labelTh,
    };
  }

  return { name: variant.name, ...(variant.nameTh ? { nameTh: variant.nameTh } : {}) };
}

export interface SpreadsheetRowMetrics {
  isSeafood: boolean;
  baseSellingPrice: number;
  sellingPrice: number;
  baseWeight: number;
  proteinWeight: number;
  secondaryProteinWeight?: number;
  proteinUnitCost: number;
  shrimpQty: number;
  squidQty: number;
  shrimpTotalCost: number;
  squidTotalCost: number;
  proteinCost: number;
  centralCost: number;
  totalRawMaterialCost: number;
  overheadCost: number;
  totalCost: number;
  fcPercent: number;
  packagingAmount: number;
  dineInProfit: number;
  effectiveTakeawayPrice: number;
  takeawayProfit: number;
}

export function computeChannelPriceFromMultiplier(
  sellingPrice: number,
  multiplier: number
): number {
  const safePrice = Number.isFinite(sellingPrice) ? Math.max(0, sellingPrice) : 0;
  const safeMult = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.round(safePrice * safeMult);
}

/**
 * Canonical Dine-in selling price resolver shared by FoodCostView and MenuPricingSpreadsheetTable.
 * Preserves Excel-template seed prices only when a seed variant still holds its exact initial seed price,
 * while never overriding any user-edited sellingPrice (including 0 when clearing an input).
 */
export function resolveVariantBaseSellingPrice(menu: MenuItem, v: MenuVariant): number {
  const pName = (v.proteinType || v.name || '').toLowerCase();
  const isSeafood = Boolean(
    v.proteinType?.includes('ทะเล') ||
      pName.includes('ทะเล') ||
      v.proteinType?.includes('ซีฟู้ด') ||
      pName.includes('ซีฟู้ด') ||
      (pName.includes('กุ้ง') && pName.includes('หมึก'))
  );

  const hasExplicitPrice = v.sellingPrice !== undefined && v.sellingPrice !== null;
  let baseSellingPrice = hasExplicitPrice ? v.sellingPrice : 69;

  if (menu.name.includes('กะเพรา') || v.menuId === 'menu_kaprow') {
    if (pName.includes('หมูหมัก')) {
      baseSellingPrice = v.sellingPrice === 65 ? 79 : baseSellingPrice;
    } else if (pName.includes('หมูบด') || pName.includes('หมูสับ')) {
      baseSellingPrice = v.sellingPrice === 60 ? 69 : baseSellingPrice;
    } else if (pName.includes('ไก่')) {
      baseSellingPrice = v.sellingPrice === 60 ? 69 : baseSellingPrice;
    } else if (
      pName.includes('เนื้อวัวสไลซ์') ||
      (pName.includes('เนื้อ') && !pName.includes('สับ'))
    ) {
      baseSellingPrice = v.sellingPrice === 85 || !hasExplicitPrice ? 129 : baseSellingPrice;
    } else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) {
      baseSellingPrice = v.sellingPrice === 85 || !hasExplicitPrice ? 99 : baseSellingPrice;
    } else if (pName.includes('กุ้ง') && !isSeafood) {
      baseSellingPrice = v.sellingPrice === 85 || !hasExplicitPrice ? 109 : baseSellingPrice;
    } else if ((pName.includes('หมึก') || pName.includes('ปลาหมึก')) && !isSeafood) {
      baseSellingPrice = v.sellingPrice === 85 || !hasExplicitPrice ? 109 : baseSellingPrice;
    } else if (isSeafood) {
      baseSellingPrice = v.sellingPrice === 95 || !hasExplicitPrice ? 129 : baseSellingPrice;
    } else if (pName.includes('ไส้กรอก')) {
      baseSellingPrice = !hasExplicitPrice ? 79 : baseSellingPrice;
    }
  }

  return baseSellingPrice;
}

/**
 * Canonical Takeaway price resolver ("ราคาใส่กล่อง") shared across FoodCostView and MenuPricingSpreadsheetTable.
 * Preserves any user-entered takeawayPrice directly while scaling template box markup cleanly if Dine-in price is edited.
 */
export function resolveVariantTakeawayPrice(
  menu: MenuItem,
  v: MenuVariant,
  sellingPriceOverride?: number
): number {
  const baseSellingPrice = resolveVariantBaseSellingPrice(menu, v);
  const effectiveSelling =
    sellingPriceOverride !== undefined
      ? Math.max(0, Number(sellingPriceOverride) || 0)
      : baseSellingPrice;
  const storedSell = Number(v.sellingPrice) || 0;
  const hasExplicitTakeaway =
    v.takeawayPrice !== undefined && v.takeawayPrice !== null;
  const storedTakeaway = hasExplicitTakeaway ? Math.max(0, Number(v.takeawayPrice) || 0) : 0;

  if (
    sellingPriceOverride === undefined &&
    hasExplicitTakeaway &&
    storedSell === baseSellingPrice
  ) {
    return storedTakeaway;
  }

  const boxMarkup =
    hasExplicitTakeaway && storedTakeaway > storedSell
      ? storedTakeaway - storedSell
      : 0;
  if (effectiveSelling <= 0) {
    return hasExplicitTakeaway ? storedTakeaway : 0;
  }
  return effectiveSelling + boxMarkup;
}

/**
 * Deterministic cost & profit calculation matching MenuPricingSpreadsheetTable.tsx 1:1
 * so Food Cost ("ต้นทุนอาหาร") and Menu Management ("จัดการเมนู") always show identical figures.
 */
export function calculateSpreadsheetRowMetrics(params: {
  menu: MenuItem;
  variant: MenuVariant;
  ingredientsMap: Map<string, Ingredient>;
  servingMode?: SpreadsheetServingMode;
  sellingPriceOverride?: number;
  proteinWeightOverride?: number;
  secondaryProteinWeightOverride?: number;
  shrimpQtyOverride?: number;
  squidQtyOverride?: number;
}): SpreadsheetRowMetrics {
  const {
    menu,
    variant: v,
    ingredientsMap,
    servingMode = 'ON_RICE',
    sellingPriceOverride,
    proteinWeightOverride,
    secondaryProteinWeightOverride,
    shrimpQtyOverride,
    squidQtyOverride,
  } = params;

  const pName = (v.proteinType || v.name || '').toLowerCase();
  const {
    isSeafood,
    shrimpItem: shrimpItemFromRecipe,
    squidItem: squidItemFromRecipe,
    primary1: proteinItem,
    primary2: secondaryProteinItem,
    allPrimaryItems,
  } = extractPrimaryRecipeItems(v);

  // Template defaults matching Food Cost spreadsheet when not customized
  const baseSellingPrice = resolveVariantBaseSellingPrice(menu, v);
  let baseWeight = 80;

  if (menu.name.includes('กะเพรา') || v.menuId === 'menu_kaprow') {
    if (pName.includes('หมูหมัก')) {
      baseWeight = 70;
    } else if (pName.includes('หมูบด') || pName.includes('หมูสับ')) {
      baseWeight = 80;
    } else if (pName.includes('ไก่')) {
      baseWeight = 80;
    } else if (
      pName.includes('เนื้อวัวสไลซ์') ||
      (pName.includes('เนื้อ') && !pName.includes('สับ'))
    ) {
      baseWeight = 120;
    } else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) {
      baseWeight = 60;
    } else if (pName.includes('กุ้ง') && !isSeafood) {
      baseWeight = 4;
    } else if ((pName.includes('หมึก') || pName.includes('ปลาหมึก')) && !isSeafood) {
      baseWeight = 80;
    } else if (isSeafood) {
      baseWeight = 80;
    } else if (pName.includes('ไส้กรอก')) {
      baseWeight = 80;
    }
  }

  const sellingPrice =
    sellingPriceOverride !== undefined ? sellingPriceOverride : baseSellingPrice;

  let proteinUnitCost = computeIngredientUnitCostForRecipeItem(proteinItem, ingredientsMap, 0);
  if (!proteinUnitCost && pName) {
    for (const ing of ingredientsMap.values()) {
      const ingLower = ing.name.toLowerCase();
      if (ingLower.includes(pName) || pName.includes(ingLower.split(' ')[0])) {
        proteinUnitCost =
          ing.costPerBaseUnit ||
          ing.purchasePrice / (ing.purchaseQuantity * ((ing.yieldPercent || 100) / 100));
        break;
      }
    }
  }
  if (!proteinUnitCost) {
    if (pName.includes('หมูหมัก')) proteinUnitCost = 0.214;
    else if (pName.includes('หมูบด') || pName.includes('หมูสับ')) proteinUnitCost = 0.113;
    else if (pName.includes('ไก่')) proteinUnitCost = 0.1;
    else if (pName.includes('เนื้อวัวสไลซ์') || pName.includes('เนื้อวัว สไลซ์'))
      proteinUnitCost = 0.4;
    else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) proteinUnitCost = 0.316;
    else if (pName.includes('กุ้ง')) proteinUnitCost = 8.5;
    else if (pName.includes('หมึก') || pName.includes('ปลาหมึก')) proteinUnitCost = 0.388;
    else if (pName.includes('ไส้กรอก')) proteinUnitCost = 0.138;
    else proteinUnitCost = 0.2;
  }

  const defaultShrimp = shrimpItemFromRecipe?.quantity || 4;
  const defaultSquid = squidItemFromRecipe?.quantity || 40;

  const shrimpQty = shrimpQtyOverride !== undefined ? shrimpQtyOverride : defaultShrimp;
  const squidQty = squidQtyOverride !== undefined ? squidQtyOverride : defaultSquid;

  const shrimpUnitCost = computeIngredientUnitCostForRecipeItem(
    shrimpItemFromRecipe,
    ingredientsMap,
    8.5
  );
  const squidUnitCost = computeIngredientUnitCostForRecipeItem(
    squidItemFromRecipe,
    ingredientsMap,
    0.388
  );
  const shrimpTotalCost = Math.round(shrimpQty * shrimpUnitCost);
  const squidTotalCost = Math.round(squidQty * squidUnitCost);
  const seafoodCombinedCost = shrimpTotalCost + squidTotalCost;

  const proteinWeight =
    proteinWeightOverride !== undefined
      ? proteinWeightOverride
      : proteinItem?.quantity !== undefined && proteinItem.quantity !== 110
      ? proteinItem.quantity
      : baseWeight;

  const secondaryProteinWeight =
    secondaryProteinWeightOverride !== undefined
      ? secondaryProteinWeightOverride
      : secondaryProteinItem?.quantity;

  const secondaryProteinUnitCost = computeIngredientUnitCostForRecipeItem(
    secondaryProteinItem,
    ingredientsMap,
    0
  );

  const primary1Cost = proteinWeight * proteinUnitCost;
  const primary2Cost =
    secondaryProteinItem && secondaryProteinWeight !== undefined
      ? secondaryProteinWeight * secondaryProteinUnitCost
      : 0;

  const proteinCost = isSeafood
    ? seafoodCombinedCost
    : Math.round(primary1Cost + primary2Cost);

  const primarySet = new Set<RecipeItem>(allPrimaryItems);
  let sumCentral = 0;
  (v.recipeItems || []).forEach((it) => {
    const lower = (it.name || '').toLowerCase();
    const isMeatOrSeafood =
      primarySet.has(it) ||
      (isSeafood &&
        (lower.includes('กุ้ง') ||
          lower.includes('หมึก') ||
          it.proteinCategory === 'SHRIMP' ||
          it.proteinCategory === 'SQUID'));
    if (!isMeatOrSeafood) {
      if (
        servingMode === 'A_LA_CARTE' &&
        (lower.includes('ข้าว') || it.ingredientId === 'ing_cooked_rice')
      ) {
        return;
      }
      sumCentral += it.calculatedLineCost || it.quantity * (it.calculatedUnitCost || 0);
    }
  });
  const centralCost = sumCentral > 0 ? Math.round(sumCentral) : 22;

  const totalRawMaterialCost = proteinCost + centralCost;

  let overheadCost = 28;
  if (pName.includes('หมูหมัก') || pName.includes('ไส้กรอก')) overheadCost = 32;
  else if (pName.includes('เนื้อวัวสไลซ์')) overheadCost = 52;
  else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) overheadCost = 40;
  else if (pName.includes('กุ้ง') || pName.includes('หมึก') || isSeafood) overheadCost = 44;
  else overheadCost = Math.round((v.overheadCost || 25) + (v.packagingCost || 7));

  const totalCost = totalRawMaterialCost + overheadCost;
  const fcPercent =
    sellingPrice > 0 ? Math.round((totalRawMaterialCost / sellingPrice) * 100) : 0;

  const packagingAmount = v.packagingCost || 9;
  const dineInProfit = Math.round(sellingPrice - totalCost + packagingAmount);

  const boxMarkup =
    v.takeawayPrice && v.sellingPrice && v.takeawayPrice > v.sellingPrice
      ? v.takeawayPrice - v.sellingPrice
      : 0;
  const effectiveTakeawayPrice = sellingPrice + boxMarkup;
  const takeawayProfit = Math.round(effectiveTakeawayPrice - totalCost);

  return {
    isSeafood,
    baseSellingPrice,
    sellingPrice,
    baseWeight,
    proteinWeight,
    ...(secondaryProteinWeight !== undefined ? { secondaryProteinWeight } : {}),
    proteinUnitCost,
    shrimpQty,
    squidQty,
    shrimpTotalCost,
    squidTotalCost,
    proteinCost,
    centralCost,
    totalRawMaterialCost,
    overheadCost,
    totalCost,
    fcPercent,
    packagingAmount,
    dineInProfit,
    effectiveTakeawayPrice,
    takeawayProfit,
  };
}
