import {
  CategoryDoc,
  DishDoc,
  DishVariant,
  IngredientDoc,
  PackagingDoc,
  RecipeIngredientItem,
  RecipePackagingItem,
  RecipeSubRecipeItem,
  SubRecipeDoc,
} from '../../types';
import {
  Ingredient as CostIngredient,
  MenuItem as CostMenuItem,
  MenuVariant as CostMenuVariant,
  Sauce as CostSauce,
} from '../types';
import { fetchCollection, getCurrentUid, saveDocument } from '../../data/db';
import { COST_COLLECTIONS, FirebaseSyncService } from './firebaseSyncService';
import { calculateIngredientCostPerBaseUnit } from '../../engine/calculations';
import { resolveBilingualDescriptionFields, resolveEntityEnglishName } from '../../utils/thaiToEnglish';
import { convertUnit } from '../engine/units';
import {
  resolveCostVariantLabel,
  resolveCostVariantDisplayNames,
} from './spreadsheetCostHelper';
import {
  filterPosOwnedCategories,
  getUnifiedCostMenuCategoryValue,
  isPosOwnedCategory,
  resolveUnifiedPosCategory,
} from '../../engine/posMenuHelpers';

export { resolveCostVariantLabel, resolveCostVariantDisplayNames };

function mapUnitToPosPurchaseUnit(unit: string): {
  purchaseUnit: string;
  baseUnit: 'g' | 'ml' | 'piece';
  multiplierToBase: number;
} {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'kg' || u === 'กิโลกรัม' || u === 'กก.') {
    return { purchaseUnit: 'kg', baseUnit: 'g', multiplierToBase: 1000 };
  }
  if (u === 'g' || u === 'กรัม') {
    return { purchaseUnit: 'g', baseUnit: 'g', multiplierToBase: 1 };
  }
  if (u === 'l' || u === 'ลิตร') {
    return { purchaseUnit: 'l', baseUnit: 'ml', multiplierToBase: 1000 };
  }
  if (u === 'ml' || u === 'มิลลิลิตร' || u === 'มล.') {
    return { purchaseUnit: 'ml', baseUnit: 'ml', multiplierToBase: 1 };
  }
  if (u === 'tbsp' || u === 'ช้อนโต๊ะ') {
    return { purchaseUnit: 'ml', baseUnit: 'ml', multiplierToBase: 15 };
  }
  if (u === 'tsp' || u === 'ช้อนชา') {
    return { purchaseUnit: 'ml', baseUnit: 'ml', multiplierToBase: 5 };
  }
  if (u === 'cup' || u === 'ถ้วย' || u === 'ถ้วยตวง') {
    return { purchaseUnit: 'ml', baseUnit: 'ml', multiplierToBase: 240 };
  }
  const rawTrimmed = (unit || '').trim();
  return { purchaseUnit: rawTrimmed || 'piece', baseUnit: 'piece', multiplierToBase: 1 };
}

function convertRecipeQtyToPosBase(
  quantity: number,
  fromUnit: string,
  targetBaseUnit: 'g' | 'ml' | 'piece'
): number {
  const conv = convertUnit(quantity, fromUnit, targetBaseUnit);
  if (conv.success) {
    return conv.convertedQuantity;
  }
  const { baseUnit, multiplierToBase } = mapUnitToPosPurchaseUnit(fromUnit);
  if (baseUnit === targetBaseUnit) {
    return quantity * multiplierToBase;
  }
  return quantity;
}

function normalizePosId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || `id_${Date.now()}`;
}

interface SharedPosContext {
  existingCategories: CategoryDoc[];
  existingIngredients: IngredientDoc[];
  existingSubRecipes: SubRecipeDoc[];
  existingPackaging: PackagingDoc[];
  existingDishes: DishDoc[];
  posIngById: Map<string, IngredientDoc>;
  posSubById: Map<string, SubRecipeDoc>;
  posPkgById: Map<string, PackagingDoc>;
}

async function syncSingleMenuWithContext(
  costMenu: CostMenuItem,
  ingMapByCostId: Map<string, CostIngredient>,
  sauceMapById: Map<string, CostSauce>,
  ctx: SharedPosContext
): Promise<{
  dishName: string;
  variantCount: number;
  createdDish: boolean;
  updatedIngredients: number;
  updatedSauces: number;
}> {
  const { existingCategories, existingIngredients, existingSubRecipes, existingPackaging, existingDishes, posIngById, posSubById, posPkgById } = ctx;
  const now = new Date().toISOString();
  let updatedIngredients = 0;
  let updatedSauces = 0;

  // 1. Resolve Category strictly from unified POS-owned categories (never inject cat_cost_* foreign categories)
  const posOwnedCategories = filterPosOwnedCategories(existingCategories);
  const matchedCat = resolveUnifiedPosCategory(costMenu.category, posOwnedCategories);
  const resolvedFallbackCategoryId = matchedCat?.id || 'cat_main';

  const ensureIngredientInPos = async (costIngId: string): Promise<string | null> => {
    const posId = `cost_ing_${normalizePosId(costIngId)}`;
    const costIng = ingMapByCostId.get(costIngId);
    if (!costIng) return posIngById.has(costIngId) ? costIngId : null;

    const byName = existingIngredients.find(
      (i) =>
        i.id === posId ||
        i.name.toLowerCase() === costIng.name.toLowerCase() ||
        (i.nameTh && i.nameTh.toLowerCase() === costIng.name.toLowerCase())
    );

    const { purchaseUnit } = mapUnitToPosPurchaseUnit(costIng.purchaseUnit);
    const calc = calculateIngredientCostPerBaseUnit(
      costIng.purchasePrice || 0,
      costIng.purchaseQuantity || 1,
      costIng.yieldPercent || 100,
      purchaseUnit
    );
    const nextCostPerBase = costIng.costPerBaseUnit || calc.costPerBaseUnit;

    const nextIngEn = resolveEntityEnglishName(costIng.thaiName || costIng.name, costIng.englishName) || costIng.name;

    if (byName) {
      const effectiveIngEn = byName.nameEnManual ? byName.name : nextIngEn;
      const changed =
        byName.name !== effectiveIngEn ||
        byName.purchasePrice !== (costIng.purchasePrice || 0) ||
        byName.purchaseQuantity !== (costIng.purchaseQuantity || 1) ||
        byName.yieldPercent !== (costIng.yieldPercent || 100) ||
        byName.purchaseUnit !== purchaseUnit ||
        Math.abs((byName.costPerBaseUnit || 0) - nextCostPerBase) > 0.00001;

      if (changed) {
        const updatedIng: IngredientDoc = {
          ...byName,
          name: effectiveIngEn,
          nameTh: costIng.thaiName || costIng.name,
          ...(byName.nameEnManual || costIng.englishNameManual ? { nameEnManual: true } : {}),
          purchaseUnit,
          purchasePrice: costIng.purchasePrice || 0,
          purchaseQuantity: costIng.purchaseQuantity || 1,
          yieldPercent: costIng.yieldPercent || 100,
          baseUnit: calc.baseUnit,
          costPerBaseUnit: nextCostPerBase,
          updatedAt: now,
        };
        await saveDocument('ingredients', updatedIng, false);
        const idx = existingIngredients.findIndex((i) => i.id === byName.id);
        if (idx >= 0) existingIngredients[idx] = updatedIng;
        posIngById.set(byName.id, updatedIng);
        updatedIngredients += 1;
      }
      return byName.id;
    }

    const newIng: IngredientDoc = {
      id: posId,
      name: nextIngEn,
      nameTh: costIng.thaiName || costIng.name,
      purchaseUnit,
      purchasePrice: costIng.purchasePrice || 0,
      purchaseQuantity: costIng.purchaseQuantity || 1,
      yieldPercent: costIng.yieldPercent || 100,
      baseUnit: calc.baseUnit,
      costPerBaseUnit: nextCostPerBase,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await saveDocument('ingredients', newIng, true);
    posIngById.set(posId, newIng);
    existingIngredients.push(newIng);
    updatedIngredients += 1;
    return posId;
  };

  const ensureSauceInPos = async (sauceId: string): Promise<string | null> => {
    const posSubId = `cost_sub_${normalizePosId(sauceId)}`;
    const sauce = sauceMapById.get(sauceId);
    if (!sauce) return posSubById.has(sauceId) ? sauceId : null;

    const subIngs: RecipeIngredientItem[] = [];
    for (const item of sauce.items || []) {
      const mappedIngId = await ensureIngredientInPos(item.ingredientId);
      if (mappedIngId) {
        const posIng = posIngById.get(mappedIngId);
        const targetBase: 'g' | 'ml' | 'piece' = posIng?.baseUnit || mapUnitToPosPurchaseUnit(item.unit).baseUnit;
        subIngs.push({
          ingredientId: mappedIngId,
          quantity: convertRecipeQtyToPosBase(item.quantity || 0, item.unit, targetBase),
        });
      }
    }

    const rawActual = Number(sauce.actualQuantity);
    if (!Number.isFinite(rawActual) || rawActual <= 0) {
      return null;
    }
    const { baseUnit: outUnit, multiplierToBase: outMult } = mapUnitToPosPurchaseUnit(sauce.productionUnit);
    const convOut = convertUnit(rawActual, sauce.productionUnit, outUnit === 'piece' ? 'g' : outUnit);
    const outQty = convOut.success ? convOut.convertedQuantity : rawActual * outMult;
    const normalizedOutUnit = outUnit === 'ml' ? 'ml' : 'g';

    const existingSub = existingSubRecipes.find(
      (s) =>
        s.id === posSubId ||
        s.name.toLowerCase() === sauce.name.toLowerCase() ||
        (s.nameTh && s.nameTh.toLowerCase() === sauce.name.toLowerCase())
    );
    if (existingSub) {
      const changed =
        existingSub.outputQuantity !== outQty ||
        existingSub.outputUnit !== normalizedOutUnit ||
        JSON.stringify(existingSub.ingredients) !== JSON.stringify(subIngs);
      if (changed) {
        const updatedSub: SubRecipeDoc = {
          ...existingSub,
          outputUnit: normalizedOutUnit,
          outputQuantity: outQty,
          ingredients: subIngs,
          updatedAt: now,
        };
        await saveDocument('subRecipes', updatedSub, false);
        const idx = existingSubRecipes.findIndex((s) => s.id === existingSub.id);
        if (idx >= 0) existingSubRecipes[idx] = updatedSub;
        posSubById.set(existingSub.id, updatedSub);
        updatedSauces += 1;
      }
      return existingSub.id;
    }

    const thName = sauce.thaiName || sauce.name;
    const newSub: SubRecipeDoc = {
      id: posSubId,
      name: resolveEntityEnglishName(thName, sauce.englishName) || thName,
      nameTh: thName,
      ...(sauce.englishNameManual ? { nameEnManual: true } : {}),
      outputUnit: normalizedOutUnit,
      outputQuantity: outQty,
      ingredients: subIngs,
      subRecipes: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await saveDocument('subRecipes', newSub, true);
    posSubById.set(posSubId, newSub);
    existingSubRecipes.push(newSub);
    updatedSauces += 1;
    return posSubId;
  };

  // 2. Build DishVariants for POS DishDoc
  const builtVariants: DishVariant[] = [];
  for (const v of costMenu.variants || []) {
    const vIngs: RecipeIngredientItem[] = [];
    const vSubs: RecipeSubRecipeItem[] = [];
    const vPkgs: RecipePackagingItem[] = [];

    for (const r of v.recipeItems || []) {
      const rType = (r.type || r.ingredientType || 'INGREDIENT').toUpperCase();
      if (rType === 'SAUCE' || r.sauceId) {
        const mappedSub = await ensureSauceInPos(r.sauceId || r.ingredientId);
        if (mappedSub) {
          vSubs.push({
            subRecipeId: mappedSub,
            quantity: r.quantity || 0,
          });
        }
      } else if (rType === 'PACKAGING') {
        const pkgId = `cost_pkg_${normalizePosId(r.ingredientId || r.name)}`;
        const pkgCost = r.calculatedUnitCost || 0;
        const existingPkg = posPkgById.get(pkgId);
        if (!existingPkg) {
          const newPkg: PackagingDoc = {
            id: pkgId,
            name: resolveEntityEnglishName(r.name) || r.name,
            nameTh: r.name,
            cost: pkgCost,
            unit: r.unit || 'piece',
            createdAt: now,
            updatedAt: now,
            version: 1,
          };
          await saveDocument('packaging', newPkg, true);
          posPkgById.set(pkgId, newPkg);
          existingPackaging.push(newPkg);
        } else if (existingPkg.cost !== pkgCost) {
          const updatedPkg: PackagingDoc = { ...existingPkg, cost: pkgCost, updatedAt: now };
          await saveDocument('packaging', updatedPkg, false);
          posPkgById.set(pkgId, updatedPkg);
        }
        vPkgs.push({ packagingId: pkgId, quantity: r.quantity || 1 });
      } else {
        const mappedIng = await ensureIngredientInPos(r.ingredientId);
        if (mappedIng) {
          const posIng = posIngById.get(mappedIng);
          const targetBase: 'g' | 'ml' | 'piece' = posIng?.baseUnit || mapUnitToPosPurchaseUnit(r.unit).baseUnit;
          vIngs.push({
            ingredientId: mappedIng,
            quantity: convertRecipeQtyToPosBase(r.quantity || 0, r.unit, targetBase),
          });
        }
      }
    }

    if ((v.packagingItems || []).length > 0) {
      for (const p of v.packagingItems || []) {
        const pkgId = `cost_pkg_${normalizePosId(p.id || p.name)}`;
        const existingPkg = posPkgById.get(pkgId);
        if (!existingPkg) {
          const newPkg: PackagingDoc = {
            id: pkgId,
            name: resolveEntityEnglishName(p.name) || p.name,
            nameTh: p.name,
            cost: p.cost || 0,
            unit: 'piece',
            createdAt: now,
            updatedAt: now,
            version: 1,
          };
          await saveDocument('packaging', newPkg, true);
          posPkgById.set(pkgId, newPkg);
          existingPackaging.push(newPkg);
        } else if (existingPkg.cost !== (p.cost || 0)) {
          const updatedPkg: PackagingDoc = { ...existingPkg, cost: p.cost || 0, updatedAt: now };
          await saveDocument('packaging', updatedPkg, false);
          posPkgById.set(pkgId, updatedPkg);
        }
        vPkgs.push({ packagingId: pkgId, quantity: 1 });
      }
    }

    const labelTh = resolveCostVariantLabel(v);
    const labelEn = resolveEntityEnglishName(labelTh, v.englishName) || labelTh;
    builtVariants.push({
      id: v.id || `var_${Date.now()}`,
      name: labelEn,
      nameTh: labelTh,
      ...(v.englishNameManual ? { nameEnManual: true } : {}),
      price: Number(v.sellingPrice) || 0,
      costMenuId: costMenu.id,
      costVariantId: v.id,
      ingredients: vIngs,
      subRecipes: vSubs,
      packaging: vPkgs,
    });
  }

  // 3. Upsert DishDoc (preserving imageId, categoryId, optionGroupIds, order, and custom variant order)
  const targetDishId = `cost_dish_${normalizePosId(costMenu.id)}`;
  const existingDish = existingDishes.find(
    (d) =>
      d.id === targetDishId ||
      d.costMenuId === costMenu.id ||
      d.name.toLowerCase() === costMenu.name.toLowerCase() ||
      (d.nameTh && d.nameTh.toLowerCase() === costMenu.name.toLowerCase())
  );

  let orderedVariants: DishVariant[] = builtVariants;
  if (existingDish && existingDish.variants?.length > 0 && builtVariants.length > 0) {
    const usedIds = new Set<string>();
    const preserved: DishVariant[] = [];
    for (const oldVar of existingDish.variants) {
      const match = builtVariants.find(
        (bv) =>
          (oldVar.costVariantId && bv.costVariantId === oldVar.costVariantId) ||
          bv.id === oldVar.id ||
          (oldVar.nameTh && bv.nameTh === oldVar.nameTh)
      );
      if (match && !usedIds.has(match.id)) {
        usedIds.add(match.id);
        preserved.push({
          ...match,
          id: oldVar.id,
          name: oldVar.nameEnManual ? oldVar.name : match.name || oldVar.name,
          nameTh: match.nameTh || oldVar.nameTh,
          ...(oldVar.nameEnManual || match.nameEnManual ? { nameEnManual: true } : {}),
        });
      }
    }
    for (const bv of builtVariants) {
      if (!usedIds.has(bv.id)) {
        preserved.push(bv);
      }
    }
    orderedVariants = preserved;
  }

  const finalVariants =
    orderedVariants.length > 0
      ? orderedVariants
      : [
          {
            id: `var_std_${Date.now()}`,
            name: 'Standard',
            nameTh: 'มาตรฐาน',
            price: 0,
            costMenuId: costMenu.id,
            ingredients: [],
            subRecipes: [],
            packaging: [],
          },
        ];

  const existingHasDesc = Boolean(
    existingDish?.description?.trim() || existingDish?.descriptionTh?.trim()
  );
  const syncedDesc = existingHasDesc
    ? resolveBilingualDescriptionFields(existingDish?.description, existingDish?.descriptionTh)
    : resolveBilingualDescriptionFields(costMenu.description, costMenu.descriptionTh);

  const dishDoc: DishDoc = {
    id: existingDish ? existingDish.id : targetDishId,
    name: existingDish?.nameEnManual
      ? existingDish.name
      : resolveEntityEnglishName(costMenu.thaiName || costMenu.name, costMenu.englishName) ||
        existingDish?.name ||
        costMenu.name,
    nameTh: costMenu.thaiName?.trim() || existingDish?.nameTh || costMenu.name,
    ...(existingDish?.nameEnManual || costMenu.englishNameManual ? { nameEnManual: true } : {}),
    categoryId:
      (costMenu.category || '').trim() && matchedCat
        ? matchedCat.id
        : existingDish?.categoryId && isPosOwnedCategory({ id: existingDish.categoryId })
        ? existingDish.categoryId
        : resolvedFallbackCategoryId,
    ...(existingDish?.imageId ? { imageId: existingDish.imageId } : {}),
    costMenuId: costMenu.id,
    ...(syncedDesc.description ? { description: syncedDesc.description } : {}),
    ...(syncedDesc.descriptionTh ? { descriptionTh: syncedDesc.descriptionTh } : {}),
    ...(existingHasDesc
      ? existingDish?.descriptionEnManual
        ? { descriptionEnManual: true }
        : {}
      : costMenu.descriptionEnManual
      ? { descriptionEnManual: true }
      : {}),
    variants: finalVariants,
    optionGroupIds: existingDish?.optionGroupIds || [],
    order: existingDish?.order || existingDishes.length + 1,
    createdAt: existingDish?.createdAt || now,
    updatedAt: now,
    version: existingDish ? existingDish.version : 1,
  };

  await saveDocument('dishes', dishDoc, !existingDish);
  if (existingDish) {
    const idx = existingDishes.findIndex((d) => d.id === existingDish.id);
    if (idx >= 0) existingDishes[idx] = dishDoc;
  } else {
    existingDishes.push(dishDoc);
  }

  return {
    dishName: dishDoc.nameTh || dishDoc.name,
    variantCount: dishDoc.variants.length,
    createdDish: !existingDish,
    updatedIngredients,
    updatedSauces,
  };
}

/**
 * Propagates bilingual dish descriptions and unified POS category changes edited in Costing Menu List ("รายการเมนูอาหาร")
 * to any linked POS DishDoc so POS Storefront and Customer Storefront stay aligned immediately.
 */
export async function propagateCostMenuDescriptionToPos(costMenu: CostMenuItem): Promise<void> {
  const [existingDishes, existingCategories] = await Promise.all([
    fetchCollection<DishDoc>('dishes'),
    fetchCollection<CategoryDoc>('categories'),
  ]);
  const expectedPosId = `cost_dish_${normalizePosId(costMenu.id)}`;
  const costTh = (costMenu.thaiName || costMenu.name || '').trim().toLowerCase();
  const costEn = (costMenu.englishName || '').trim().toLowerCase();

  const matchingDishes = existingDishes.filter(
    (d) =>
      d.costMenuId === costMenu.id ||
      d.id === expectedPosId ||
      (costTh && (d.nameTh || '').trim().toLowerCase() === costTh) ||
      (costEn && (d.name || '').trim().toLowerCase() === costEn) ||
      (d.variants || []).some((v) => v.costMenuId === costMenu.id)
  );
  if (matchingDishes.length === 0) return;

  const posOwnedCategories = filterPosOwnedCategories(existingCategories);
  const matchedCat = (costMenu.category || '').trim()
    ? resolveUnifiedPosCategory(costMenu.category, posOwnedCategories)
    : null;

  const resolvedDesc = resolveBilingualDescriptionFields(
    costMenu.description,
    costMenu.descriptionTh
  );
  const now = new Date().toISOString();

  for (const dish of matchingDishes) {
    const nextDesc = resolvedDesc.description || '';
    const nextDescTh = resolvedDesc.descriptionTh || '';
    const nextManual = Boolean(costMenu.descriptionEnManual && nextDesc);
    const nextCategoryId = matchedCat ? matchedCat.id : dish.categoryId;
    if (
      (dish.description || '') === nextDesc &&
      (dish.descriptionTh || '') === nextDescTh &&
      Boolean(dish.descriptionEnManual) === nextManual &&
      dish.categoryId === nextCategoryId
    ) {
      continue;
    }

    const updatedDish: DishDoc = {
      ...dish,
      categoryId: nextCategoryId,
      updatedAt: now,
      version: (dish.version || 0) + 1,
    };
    if (nextDesc) updatedDish.description = nextDesc;
    else delete updatedDish.description;
    if (nextDescTh) updatedDish.descriptionTh = nextDescTh;
    else delete updatedDish.descriptionTh;
    if (nextDesc || nextDescTh) updatedDish.descriptionEnManual = nextManual;
    else delete updatedDish.descriptionEnManual;

    await saveDocument('dishes', updatedDish, false);
  }
}

/**
 * Syncs a POS dish's new category back to its linked Costing MenuItem so both POS and Costing stay unified.
 */
export async function syncLinkedCostMenuCategoryFromPos(
  dish: Pick<DishDoc, 'id' | 'costMenuId' | 'name' | 'nameTh' | 'variants'>,
  targetCategory: CategoryDoc | undefined,
  costMenus: CostMenuItem[]
): Promise<void> {
  if (!targetCategory || costMenus.length === 0) return;
  const uid = getCurrentUid();
  if (!uid) return;

  const targetCatName = getUnifiedCostMenuCategoryValue(targetCategory);
  if (!targetCatName) return;

  const dTh = (dish.nameTh || '').trim().toLowerCase();
  const dEn = (dish.name || '').trim().toLowerCase();
  const varMenuIds = new Set(
    (dish.variants || []).map((v) => v.costMenuId).filter((id): id is string => Boolean(id))
  );

  const linkedMenus = costMenus.filter(
    (m) =>
      m.id === dish.costMenuId ||
      `cost_dish_${normalizePosId(m.id)}` === dish.id ||
      varMenuIds.has(m.id) ||
      (dTh && ((m.thaiName || m.name || '').trim().toLowerCase() === dTh)) ||
      (dEn && ((m.englishName || '').trim().toLowerCase() === dEn))
  );

  const now = new Date().toISOString();
  for (const menu of linkedMenus) {
    if ((menu.category || '').trim() === targetCatName) continue;
    await FirebaseSyncService.saveUserDoc(uid, COST_COLLECTIONS.MENUS, menu.id, {
      ...menu,
      category: targetCatName,
      updatedAt: now,
    });
  }
}

/**
 * Updates linked CostMenuItem.category whenever a POS category is renamed or deleted on POS.
 */
export async function syncCostMenusOnPosCategoryChange(
  affectedCategoryId: string,
  replacementCategory: CategoryDoc | undefined,
  costMenus: CostMenuItem[],
  posCategories: CategoryDoc[]
): Promise<void> {
  if (!affectedCategoryId || !replacementCategory || costMenus.length === 0) return;
  const uid = getCurrentUid();
  if (!uid) return;

  const replacementName = getUnifiedCostMenuCategoryValue(replacementCategory);
  if (!replacementName) return;

  const validPosCats = filterPosOwnedCategories(posCategories);
  const now = new Date().toISOString();
  for (const menu of costMenus) {
    const resolved = resolveUnifiedPosCategory(menu.category, validPosCats);
    if (resolved?.id === affectedCategoryId && (menu.category || '').trim() !== replacementName) {
      await FirebaseSyncService.saveUserDoc(uid, COST_COLLECTIONS.MENUS, menu.id, {
        ...menu,
        category: replacementName,
        updatedAt: now,
      });
    }
  }
}

/**
 * Syncs a Costing MenuItem (and any referenced Costing Ingredients / Sauces)
 * directly into KinPOS's active Firestore POS menu (`dishes`, `ingredients`, `subRecipes`, `categories`)
 * so it is immediately orderable on Tables & POS.
 */
export async function syncCostingMenuToPOS(
  costMenu: CostMenuItem,
  costIngredients: CostIngredient[],
  costSauces: CostSauce[]
): Promise<{ dishName: string; variantCount: number; createdDish: boolean }> {
  const [existingCategories, existingIngredients, existingSubRecipes, existingPackaging, existingDishes] =
    await Promise.all([
      fetchCollection<CategoryDoc>('categories'),
      fetchCollection<IngredientDoc>('ingredients'),
      fetchCollection<SubRecipeDoc>('subRecipes'),
      fetchCollection<PackagingDoc>('packaging'),
      fetchCollection<DishDoc>('dishes'),
    ]);

  const ctx: SharedPosContext = {
    existingCategories,
    existingIngredients,
    existingSubRecipes,
    existingPackaging,
    existingDishes,
    posIngById: new Map<string, IngredientDoc>(existingIngredients.map((i) => [i.id, i])),
    posSubById: new Map<string, SubRecipeDoc>(existingSubRecipes.map((s) => [s.id, s])),
    posPkgById: new Map<string, PackagingDoc>(existingPackaging.map((p) => [p.id, p])),
  };

  const res = await syncSingleMenuWithContext(
    costMenu,
    new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i])),
    new Map<string, CostSauce>(costSauces.map((s) => [s.id, s])),
    ctx
  );

  return {
    dishName: res.dishName,
    variantCount: res.variantCount,
    createdDish: res.createdDish,
  };
}

/**
 * Syncs ALL edited Food Cost data (all active Costing menus, ingredients, and sauces)
 * into KinPOS's active Firestore POS menu immediately in one batch pass.
 */
export async function syncAllCostingToPOS(
  costMenus: CostMenuItem[],
  costIngredients: CostIngredient[],
  costSauces: CostSauce[]
): Promise<{
  syncedMenusCount: number;
  createdDishesCount: number;
  updatedDishesCount: number;
  updatedIngredientsCount: number;
  updatedSaucesCount: number;
}> {
  const [existingCategories, existingIngredients, existingSubRecipes, existingPackaging, existingDishes] =
    await Promise.all([
      fetchCollection<CategoryDoc>('categories'),
      fetchCollection<IngredientDoc>('ingredients'),
      fetchCollection<SubRecipeDoc>('subRecipes'),
      fetchCollection<PackagingDoc>('packaging'),
      fetchCollection<DishDoc>('dishes'),
    ]);

  const now = new Date().toISOString();
  const ingMapByCostId = new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i]));
  const sauceMapById = new Map<string, CostSauce>(costSauces.map((s) => [s.id, s]));

  const ctx: SharedPosContext = {
    existingCategories,
    existingIngredients,
    existingSubRecipes,
    existingPackaging,
    existingDishes,
    posIngById: new Map<string, IngredientDoc>(existingIngredients.map((i) => [i.id, i])),
    posSubById: new Map<string, SubRecipeDoc>(existingSubRecipes.map((s) => [s.id, s])),
    posPkgById: new Map<string, PackagingDoc>(existingPackaging.map((p) => [p.id, p])),
  };

  let updatedIngredientsCount = 0;
  let updatedSaucesCount = 0;
  let createdDishesCount = 0;
  let updatedDishesCount = 0;
  let syncedMenusCount = 0;

  // 1. Update all matching existing POS ingredients so even standalone POS dishes get fresh ingredient costs
  for (const costIng of costIngredients) {
    const posId = `cost_ing_${normalizePosId(costIng.id)}`;
    const existing = existingIngredients.find(
      (i) =>
        i.id === posId ||
        i.name.toLowerCase() === costIng.name.toLowerCase() ||
        (i.nameTh && i.nameTh.toLowerCase() === costIng.name.toLowerCase())
    );
    if (existing) {
      const { purchaseUnit } = mapUnitToPosPurchaseUnit(costIng.purchaseUnit);
      const calc = calculateIngredientCostPerBaseUnit(
        costIng.purchasePrice || 0,
        costIng.purchaseQuantity || 1,
        costIng.yieldPercent || 100,
        purchaseUnit
      );
      const nextCostPerBase = costIng.costPerBaseUnit || calc.costPerBaseUnit;
      const changed =
        existing.purchasePrice !== (costIng.purchasePrice || 0) ||
        existing.purchaseQuantity !== (costIng.purchaseQuantity || 1) ||
        existing.yieldPercent !== (costIng.yieldPercent || 100) ||
        existing.purchaseUnit !== purchaseUnit ||
        Math.abs((existing.costPerBaseUnit || 0) - nextCostPerBase) > 0.00001;
      if (changed) {
        const updatedIng: IngredientDoc = {
          ...existing,
          purchaseUnit,
          purchasePrice: costIng.purchasePrice || 0,
          purchaseQuantity: costIng.purchaseQuantity || 1,
          yieldPercent: costIng.yieldPercent || 100,
          baseUnit: calc.baseUnit,
          costPerBaseUnit: nextCostPerBase,
          updatedAt: now,
        };
        await saveDocument('ingredients', updatedIng, false);
        const idx = existingIngredients.findIndex((i) => i.id === existing.id);
        if (idx >= 0) existingIngredients[idx] = updatedIng;
        ctx.posIngById.set(existing.id, updatedIng);
        updatedIngredientsCount += 1;
      }
    }
  }

  // 2. Sync every active costing menu into POS dishes
  const activeCostMenus = costMenus.filter((m) => m.active !== false);
  for (const menu of activeCostMenus) {
    const res = await syncSingleMenuWithContext(menu, ingMapByCostId, sauceMapById, ctx);
    syncedMenusCount += 1;
    if (res.createdDish) createdDishesCount += 1;
    else updatedDishesCount += 1;
    updatedIngredientsCount += res.updatedIngredients;
    updatedSaucesCount += res.updatedSauces;
  }

  // 3. Also refresh any other POS dishes that linked individual variants via costVariantId / costMenuId
  const activeCostVariantMap = new Map<string, CostMenuVariant>();
  for (const m of activeCostMenus) {
    for (const v of m.variants || []) {
      activeCostVariantMap.set(v.id, v);
    }
  }
  const syncedDishIds = new Set(
    activeCostMenus.map((m) => `cost_dish_${normalizePosId(m.id)}`)
  );
  for (const dish of existingDishes) {
    if (syncedDishIds.has(dish.id)) continue;
    let dishChanged = false;
    const nextVariants = (dish.variants || []).map((dv) => {
      if (!dv.costVariantId) return dv;
      const cv = activeCostVariantMap.get(dv.costVariantId);
      if (!cv) return dv;
      const labelTh = resolveCostVariantLabel(cv);
      const labelEn = dv.nameEnManual
        ? dv.name
        : resolveEntityEnglishName(labelTh, cv.englishName) || labelTh;
      const nextPrice = Number(cv.sellingPrice) || dv.price;
      if (nextPrice !== dv.price || dv.nameTh !== labelTh || dv.name !== labelEn) {
        dishChanged = true;
        return {
          ...dv,
          price: nextPrice,
          nameTh: labelTh,
          name: labelEn,
          ...(dv.nameEnManual || cv.englishNameManual ? { nameEnManual: true } : {}),
        };
      }
      return dv;
    });
    if (dishChanged) {
      await saveDocument(
        'dishes',
        { ...dish, variants: nextVariants, updatedAt: now },
        false
      );
      updatedDishesCount += 1;
    }
  }

  return {
    syncedMenusCount,
    createdDishesCount,
    updatedDishesCount,
    updatedIngredientsCount,
    updatedSaucesCount,
  };
}

export async function importCostingVariantToDishVariant(params: {
  variant: CostMenuVariant;
  costMenuId?: string;
  costIngredients: CostIngredient[];
  costSauces: CostSauce[];
  preferredNameTh?: string;
}): Promise<DishVariant> {
  const { variant: v, costMenuId, costIngredients, costSauces, preferredNameTh } = params;
  const [existingIngredients, existingSubRecipes, existingPackaging] = await Promise.all([
    fetchCollection<IngredientDoc>('ingredients'),
    fetchCollection<SubRecipeDoc>('subRecipes'),
    fetchCollection<PackagingDoc>('packaging'),
  ]);

  const now = new Date().toISOString();
  const ingMapByCostId = new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i]));
  const posIngById = new Map<string, IngredientDoc>(existingIngredients.map((i) => [i.id, i]));
  const sauceMapById = new Map<string, CostSauce>(costSauces.map((s) => [s.id, s]));
  const posSubById = new Map<string, SubRecipeDoc>(existingSubRecipes.map((s) => [s.id, s]));
  const posPkgById = new Map<string, PackagingDoc>(existingPackaging.map((p) => [p.id, p]));

  const ensureIngredientInPos = async (costIngId: string): Promise<string | null> => {
    const posId = `cost_ing_${normalizePosId(costIngId)}`;
    const costIng = ingMapByCostId.get(costIngId);
    if (!costIng) return posIngById.has(costIngId) ? costIngId : null;

    const byName = existingIngredients.find(
      (i) =>
        i.id === posId ||
        i.name.toLowerCase() === costIng.name.toLowerCase() ||
        (i.nameTh && i.nameTh.toLowerCase() === costIng.name.toLowerCase())
    );
    if (byName) return byName.id;

    const { purchaseUnit } = mapUnitToPosPurchaseUnit(costIng.purchaseUnit);
    const calc = calculateIngredientCostPerBaseUnit(
      costIng.purchasePrice || 0,
      costIng.purchaseQuantity || 1,
      costIng.yieldPercent || 100,
      purchaseUnit
    );

    const newIng: IngredientDoc = {
      id: posId,
      name: resolveEntityEnglishName(costIng.thaiName || costIng.name, costIng.englishName) || costIng.name,
      nameTh: costIng.thaiName || costIng.name,
      ...(costIng.englishNameManual ? { nameEnManual: true } : {}),
      purchaseUnit,
      purchasePrice: costIng.purchasePrice || 0,
      purchaseQuantity: costIng.purchaseQuantity || 1,
      yieldPercent: costIng.yieldPercent || 100,
      baseUnit: calc.baseUnit,
      costPerBaseUnit: costIng.costPerBaseUnit || calc.costPerBaseUnit,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await saveDocument('ingredients', newIng, true);
    posIngById.set(posId, newIng);
    existingIngredients.push(newIng);
    return posId;
  };

  const ensureSauceInPos = async (sauceId: string): Promise<string | null> => {
    const posSubId = `cost_sub_${normalizePosId(sauceId)}`;
    const sauce = sauceMapById.get(sauceId);
    if (!sauce) return posSubById.has(sauceId) ? sauceId : null;

    const existingSub = existingSubRecipes.find(
      (s) =>
        s.id === posSubId ||
        s.name.toLowerCase() === sauce.name.toLowerCase() ||
        (s.nameTh && s.nameTh.toLowerCase() === sauce.name.toLowerCase())
    );
    if (existingSub) return existingSub.id;

    const subIngs: RecipeIngredientItem[] = [];
    for (const item of sauce.items || []) {
      const mappedIngId = await ensureIngredientInPos(item.ingredientId);
      if (mappedIngId) {
        const posIng = posIngById.get(mappedIngId);
        const targetBase: 'g' | 'ml' | 'piece' = posIng?.baseUnit || mapUnitToPosPurchaseUnit(item.unit).baseUnit;
        subIngs.push({
          ingredientId: mappedIngId,
          quantity: convertRecipeQtyToPosBase(item.quantity || 0, item.unit, targetBase),
        });
      }
    }

    const rawActual = Number(sauce.actualQuantity);
    if (!Number.isFinite(rawActual) || rawActual <= 0) {
      return null;
    }
    const { baseUnit: outUnit, multiplierToBase: outMult } = mapUnitToPosPurchaseUnit(sauce.productionUnit);
    const convOut = convertUnit(rawActual, sauce.productionUnit, outUnit === 'piece' ? 'g' : outUnit);
    const outQty = convOut.success ? convOut.convertedQuantity : rawActual * outMult;
    const thName = sauce.thaiName || sauce.name;
    const newSub: SubRecipeDoc = {
      id: posSubId,
      name: resolveEntityEnglishName(thName, sauce.englishName) || thName,
      nameTh: thName,
      ...(sauce.englishNameManual ? { nameEnManual: true } : {}),
      outputUnit: outUnit === 'ml' ? 'ml' : 'g',
      outputQuantity: outQty,
      ingredients: subIngs,
      subRecipes: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await saveDocument('subRecipes', newSub, true);
    posSubById.set(posSubId, newSub);
    existingSubRecipes.push(newSub);
    return posSubId;
  };

  const vIngs: RecipeIngredientItem[] = [];
  const vSubs: RecipeSubRecipeItem[] = [];
  const vPkgs: RecipePackagingItem[] = [];

  for (const r of v.recipeItems || []) {
    const rType = (r.type || r.ingredientType || 'INGREDIENT').toUpperCase();
    if (rType === 'SAUCE' || r.sauceId) {
      const mappedSub = await ensureSauceInPos(r.sauceId || r.ingredientId);
      if (mappedSub) {
        vSubs.push({
          subRecipeId: mappedSub,
          quantity: r.quantity || 0,
        });
      }
    } else if (rType === 'PACKAGING') {
      const pkgId = `cost_pkg_${normalizePosId(r.ingredientId || r.name)}`;
      if (!posPkgById.has(pkgId)) {
        const pkgCost = r.calculatedUnitCost || 0;
        const newPkg: PackagingDoc = {
          id: pkgId,
          name: resolveEntityEnglishName(r.name) || r.name,
          nameTh: r.name,
          cost: pkgCost,
          unit: r.unit || 'piece',
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        await saveDocument('packaging', newPkg, true);
        posPkgById.set(pkgId, newPkg);
      }
      vPkgs.push({ packagingId: pkgId, quantity: r.quantity || 1 });
    } else {
      const mappedIng = await ensureIngredientInPos(r.ingredientId);
      if (mappedIng) {
        const posIng = posIngById.get(mappedIng);
        const targetBase: 'g' | 'ml' | 'piece' = posIng?.baseUnit || mapUnitToPosPurchaseUnit(r.unit).baseUnit;
        vIngs.push({
          ingredientId: mappedIng,
          quantity: convertRecipeQtyToPosBase(r.quantity || 0, r.unit, targetBase),
        });
      }
    }
  }

  for (const p of v.packagingItems || []) {
    const pkgId = `cost_pkg_${normalizePosId(p.id || p.name)}`;
    if (!posPkgById.has(pkgId)) {
      const newPkg: PackagingDoc = {
        id: pkgId,
        name: resolveEntityEnglishName(p.name) || p.name,
        nameTh: p.name,
        cost: p.cost || 0,
        unit: 'piece',
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await saveDocument('packaging', newPkg, true);
      posPkgById.set(pkgId, newPkg);
    }
    vPkgs.push({ packagingId: pkgId, quantity: 1 });
  }

  const itemLabelTh = (v.thaiName || v.name || '').trim();
  const labelTh = preferredNameTh?.trim() || itemLabelTh || v.proteinType?.trim() || 'มาตรฐาน';
  const sameAsVariantLabel = !preferredNameTh?.trim() || preferredNameTh.trim() === itemLabelTh;
  const labelEn =
    (sameAsVariantLabel ? resolveEntityEnglishName(labelTh, v.englishName) : resolveEntityEnglishName(labelTh)) ||
    labelTh;

  return {
    id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: labelEn,
    nameTh: labelTh,
    ...(sameAsVariantLabel && v.englishNameManual ? { nameEnManual: true } : {}),
    price: Number(v.sellingPrice) || 0,
    ...(costMenuId ? { costMenuId } : v.menuId ? { costMenuId: v.menuId } : {}),
    costVariantId: v.id,
    ingredients: vIngs,
    subRecipes: vSubs,
    packaging: vPkgs,
  };
}

export async function importCostingIngredientAsDishVariant(
  costIng: CostIngredient,
  quantityInRecipeUnit = 100
): Promise<DishVariant> {
  const existingIngredients = await fetchCollection<IngredientDoc>('ingredients');
  const now = new Date().toISOString();
  const posId = `cost_ing_${normalizePosId(costIng.id)}`;

  let matched = existingIngredients.find(
    (i) =>
      i.id === posId ||
      i.name.toLowerCase() === costIng.name.toLowerCase() ||
      (i.nameTh && i.nameTh.toLowerCase() === costIng.name.toLowerCase())
  );

  const { purchaseUnit, multiplierToBase } = mapUnitToPosPurchaseUnit(costIng.purchaseUnit);

  if (!matched) {
    const calc = calculateIngredientCostPerBaseUnit(
      costIng.purchasePrice || 0,
      costIng.purchaseQuantity || 1,
      costIng.yieldPercent || 100,
      purchaseUnit
    );
    matched = {
      id: posId,
      name: resolveEntityEnglishName(costIng.thaiName || costIng.name, costIng.englishName) || costIng.name,
      nameTh: costIng.thaiName || costIng.name,
      ...(costIng.englishNameManual ? { nameEnManual: true } : {}),
      purchaseUnit,
      purchasePrice: costIng.purchasePrice || 0,
      purchaseQuantity: costIng.purchaseQuantity || 1,
      yieldPercent: costIng.yieldPercent || 100,
      baseUnit: calc.baseUnit,
      costPerBaseUnit: costIng.costPerBaseUnit || calc.costPerBaseUnit,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await saveDocument('ingredients', matched, true);
  }

  const usageQty = matched.baseUnit === 'piece' ? 1 : quantityInRecipeUnit;

  const labelTh = costIng.thaiName || costIng.name;
  const labelEn = resolveEntityEnglishName(labelTh, costIng.englishName) || labelTh;

  return {
    id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: labelEn,
    nameTh: labelTh,
    price: 0,
    ingredients: [{ ingredientId: matched.id, quantity: usageQty }],
    subRecipes: [],
    packaging: [],
  };
}

