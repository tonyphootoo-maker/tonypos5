import { Ingredient, MenuItem, MenuVariant } from '../types';

export type SpreadsheetServingMode = 'ON_RICE' | 'A_LA_CARTE';

export interface SpreadsheetRowMetrics {
  isSeafood: boolean;
  baseSellingPrice: number;
  sellingPrice: number;
  baseWeight: number;
  proteinWeight: number;
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
    shrimpQtyOverride,
    squidQtyOverride,
  } = params;

  const pName = (v.proteinType || v.name || '').toLowerCase();
  const isSeafood = Boolean(
    v.proteinType?.includes('ทะเล') ||
      pName.includes('ทะเล') ||
      v.proteinType?.includes('ซีฟู้ด') ||
      pName.includes('ซีฟู้ด') ||
      (pName.includes('กุ้ง') && pName.includes('หมึก'))
  );

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

  const proteinItem =
    (v.recipeItems || []).find((it) => {
      const lower = (it.name || '').toLowerCase();
      return (
        it.proteinCategory ||
        lower.includes('หมู') ||
        lower.includes('ไก่') ||
        lower.includes('เนื้อ') ||
        lower.includes('กุ้ง') ||
        lower.includes('หมึก') ||
        lower.includes('ไส้กรอก') ||
        lower.includes('ปลา')
      );
    }) || (v.recipeItems && v.recipeItems[0]);

  let proteinUnitCost = proteinItem?.calculatedUnitCost || 0;
  if (!proteinUnitCost && proteinItem?.ingredientId) {
    const ing = ingredientsMap.get(proteinItem.ingredientId);
    if (ing) {
      proteinUnitCost =
        ing.costPerBaseUnit ||
        ing.purchasePrice / (ing.purchaseQuantity * ((ing.yieldPercent || 100) / 100));
    }
  }
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

  const shrimpItemFromRecipe = (v.recipeItems || []).find(
    (it) => it.proteinCategory === 'SHRIMP' || (it.name || '').toLowerCase().includes('กุ้ง')
  );
  const squidItemFromRecipe = (v.recipeItems || []).find(
    (it) =>
      it.proteinCategory === 'SQUID' ||
      (it.name || '').toLowerCase().includes('หมึก') ||
      (it.name || '').toLowerCase().includes('ปลาหมึก')
  );

  const defaultShrimp = shrimpItemFromRecipe?.quantity || 4;
  const defaultSquid = squidItemFromRecipe?.quantity || 40;

  const shrimpQty = shrimpQtyOverride !== undefined ? shrimpQtyOverride : defaultShrimp;
  const squidQty = squidQtyOverride !== undefined ? squidQtyOverride : defaultSquid;

  const shrimpUnitCost = shrimpItemFromRecipe?.calculatedUnitCost || 8.5;
  const squidUnitCost = squidItemFromRecipe?.calculatedUnitCost || 0.388;
  const shrimpTotalCost = Math.round(shrimpQty * shrimpUnitCost);
  const squidTotalCost = Math.round(squidQty * squidUnitCost);
  const seafoodCombinedCost = shrimpTotalCost + squidTotalCost;

  const proteinWeight =
    proteinWeightOverride !== undefined
      ? proteinWeightOverride
      : proteinItem?.quantity !== undefined && proteinItem.quantity !== 110
      ? proteinItem.quantity
      : baseWeight;

  const proteinCost = isSeafood
    ? seafoodCombinedCost
    : Math.round(proteinWeight * proteinUnitCost);

  let sumCentral = 0;
  (v.recipeItems || []).forEach((it) => {
    const lower = (it.name || '').toLowerCase();
    const isMeatOrSeafood =
      it === proteinItem ||
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
