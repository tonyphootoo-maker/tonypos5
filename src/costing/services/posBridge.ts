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
import { fetchCollection, saveDocument } from '../../data/db';
import { calculateIngredientCostPerBaseUnit } from '../../engine/calculations';
import { translateThaiToEnglish } from '../../utils/thaiToEnglish';

function mapUnitToPosPurchaseUnit(unit: string): {
  purchaseUnit: string;
  baseUnit: 'g' | 'ml' | 'piece';
  multiplierToBase: number;
} {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'kg' || u === 'กิโลกรัม') {
    return { purchaseUnit: 'kg', baseUnit: 'g', multiplierToBase: 1000 };
  }
  if (u === 'g' || u === 'กรัม') {
    return { purchaseUnit: 'g', baseUnit: 'g', multiplierToBase: 1 };
  }
  if (u === 'l' || u === 'ลิตร') {
    return { purchaseUnit: 'l', baseUnit: 'ml', multiplierToBase: 1000 };
  }
  if (u === 'ml' || u === 'มิลลิลิตร') {
    return { purchaseUnit: 'ml', baseUnit: 'ml', multiplierToBase: 1 };
  }
  return { purchaseUnit: 'piece', baseUnit: 'piece', multiplierToBase: 1 };
}

function normalizePosId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || `id_${Date.now()}`;
}

function resolveCostVariantLabel(v: CostMenuVariant): string {
  const p = (v.proteinType || '').trim();
  if (p && p !== 'ทั่วไป' && p !== 'Standard') {
    return p;
  }
  return (v.name || p || 'มาตรฐาน').trim();
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

  // 1. Ensure Category
  const catName = costMenu.category || 'อาหารจานหลัก';
  let matchedCat = existingCategories.find(
    (c) =>
      c.name.toLowerCase() === catName.toLowerCase() ||
      (c.nameTh && c.nameTh.toLowerCase() === catName.toLowerCase())
  );
  if (!matchedCat) {
    matchedCat = {
      id: `cat_cost_${normalizePosId(catName).slice(0, 24)}`,
      name: catName,
      nameTh: catName,
      order: existingCategories.length + 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await saveDocument('categories', matchedCat, true);
    existingCategories.push(matchedCat);
  }

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

    if (byName) {
      const changed =
        byName.purchasePrice !== (costIng.purchasePrice || 0) ||
        byName.purchaseQuantity !== (costIng.purchaseQuantity || 1) ||
        byName.yieldPercent !== (costIng.yieldPercent || 100) ||
        byName.purchaseUnit !== purchaseUnit ||
        Math.abs((byName.costPerBaseUnit || 0) - nextCostPerBase) > 0.00001;

      if (changed) {
        const updatedIng: IngredientDoc = {
          ...byName,
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
      name: translateThaiToEnglish(costIng.name) || costIng.name,
      nameTh: costIng.name,
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
        const { multiplierToBase } = mapUnitToPosPurchaseUnit(item.unit);
        subIngs.push({
          ingredientId: mappedIngId,
          quantity: (item.quantity || 0) * multiplierToBase,
        });
      }
    }

    const { multiplierToBase: outMult } = mapUnitToPosPurchaseUnit(sauce.productionUnit);
    const outQty = Math.max(1, (sauce.actualQuantity || sauce.productionQuantity || 1) * outMult);
    const outUnit = sauce.productionUnit === 'kg' ? 'g' : sauce.productionUnit === 'l' ? 'ml' : 'g';

    const existingSub = existingSubRecipes.find(
      (s) =>
        s.id === posSubId ||
        s.name.toLowerCase() === sauce.name.toLowerCase() ||
        (s.nameTh && s.nameTh.toLowerCase() === sauce.name.toLowerCase())
    );
    if (existingSub) {
      const changed =
        existingSub.outputQuantity !== outQty ||
        existingSub.outputUnit !== outUnit ||
        JSON.stringify(existingSub.ingredients) !== JSON.stringify(subIngs);
      if (changed) {
        const updatedSub: SubRecipeDoc = {
          ...existingSub,
          outputUnit: outUnit,
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
      name: sauce.englishName || translateThaiToEnglish(thName) || thName,
      nameTh: thName,
      outputUnit: outUnit,
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
            name: translateThaiToEnglish(r.name) || r.name,
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
          const { multiplierToBase } = mapUnitToPosPurchaseUnit(r.unit);
          vIngs.push({
            ingredientId: mappedIng,
            quantity: (r.quantity || 0) * multiplierToBase,
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
            name: translateThaiToEnglish(p.name) || p.name,
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
    const labelEn = translateThaiToEnglish(labelTh) || labelTh;
    builtVariants.push({
      id: v.id || `var_${Date.now()}`,
      name: labelEn,
      nameTh: labelTh,
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
          name: oldVar.name || match.name,
          nameTh: oldVar.nameTh || match.nameTh,
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

  const dishDoc: DishDoc = {
    id: existingDish ? existingDish.id : targetDishId,
    name: existingDish?.name || translateThaiToEnglish(costMenu.name) || costMenu.name,
    nameTh: existingDish?.nameTh || costMenu.name,
    categoryId: existingDish?.categoryId || matchedCat.id,
    ...(existingDish?.imageId ? { imageId: existingDish.imageId } : {}),
    costMenuId: costMenu.id,
    ...(costMenu.description ? { description: costMenu.description } : existingDish?.description ? { description: existingDish.description } : {}),
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
      const nextPrice = Number(cv.sellingPrice) || dv.price;
      if (nextPrice !== dv.price) {
        dishChanged = true;
        return { ...dv, price: nextPrice };
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
      name: translateThaiToEnglish(costIng.name) || costIng.name,
      nameTh: costIng.name,
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
        const { multiplierToBase } = mapUnitToPosPurchaseUnit(item.unit);
        subIngs.push({
          ingredientId: mappedIngId,
          quantity: (item.quantity || 0) * multiplierToBase,
        });
      }
    }

    const { multiplierToBase: outMult } = mapUnitToPosPurchaseUnit(sauce.productionUnit);
    const thName = sauce.thaiName || sauce.name;
    const newSub: SubRecipeDoc = {
      id: posSubId,
      name: sauce.englishName || translateThaiToEnglish(thName) || thName,
      nameTh: thName,
      outputUnit: sauce.productionUnit === 'kg' ? 'g' : sauce.productionUnit === 'l' ? 'ml' : 'g',
      outputQuantity: Math.max(1, (sauce.actualQuantity || sauce.productionQuantity || 1) * outMult),
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
          name: translateThaiToEnglish(r.name) || r.name,
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
        const { multiplierToBase } = mapUnitToPosPurchaseUnit(r.unit);
        vIngs.push({
          ingredientId: mappedIng,
          quantity: (r.quantity || 0) * multiplierToBase,
        });
      }
    }
  }

  for (const p of v.packagingItems || []) {
    const pkgId = `cost_pkg_${normalizePosId(p.id || p.name)}`;
    if (!posPkgById.has(pkgId)) {
      const newPkg: PackagingDoc = {
        id: pkgId,
        name: translateThaiToEnglish(p.name) || p.name,
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

  const labelTh = preferredNameTh?.trim() || v.proteinType?.trim() || v.name;
  const labelEn = translateThaiToEnglish(labelTh) || labelTh;

  return {
    id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: labelEn,
    nameTh: labelTh,
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
      name: translateThaiToEnglish(costIng.name) || costIng.name,
      nameTh: costIng.name,
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

  const labelTh = costIng.name;
  const labelEn = translateThaiToEnglish(labelTh) || labelTh;

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

