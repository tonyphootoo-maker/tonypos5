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
  Sauce as CostSauce,
} from '../types';
import { fetchCollection, saveDocument } from '../../data/db';
import { calculateIngredientCostPerBaseUnit } from '../../engine/calculations';

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

  const now = new Date().toISOString();

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
  }

  // Helpers to ensure an ingredient or sub-recipe exists in POS collections
  const ingMapByCostId = new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i]));
  const posIngById = new Map<string, IngredientDoc>(existingIngredients.map((i) => [i.id, i]));
  const sauceMapById = new Map<string, CostSauce>(costSauces.map((s) => [s.id, s]));
  const posSubById = new Map<string, SubRecipeDoc>(existingSubRecipes.map((s) => [s.id, s]));
  const posPkgById = new Map<string, PackagingDoc>(existingPackaging.map((p) => [p.id, p]));

  const ensureIngredientInPos = async (costIngId: string): Promise<string | null> => {
    const posId = `cost_ing_${normalizePosId(costIngId)}`;
    const costIng = ingMapByCostId.get(costIngId);
    if (!costIng) return posIngById.has(costIngId) ? costIngId : null;

    // Try matching by existing name too
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

    if (byName) {
      return byName.id;
    }

    const newIng: IngredientDoc = {
      id: posId,
      name: costIng.name,
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
    const newSub: SubRecipeDoc = {
      id: posSubId,
      name: sauce.name,
      nameTh: sauce.thaiName || sauce.name,
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

  // 2. Build DishVariants for POS DishDoc
  const posVariants: DishVariant[] = [];
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
        if (!posPkgById.has(pkgId)) {
          const pkgCost = r.calculatedUnitCost || 0;
          const newPkg: PackagingDoc = {
            id: pkgId,
            name: r.name,
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

    // Also include packagingItems on variant if defined
    if ((v.packagingItems || []).length > 0) {
      for (const p of v.packagingItems || []) {
        const pkgId = `cost_pkg_${normalizePosId(p.id || p.name)}`;
        if (!posPkgById.has(pkgId)) {
          const newPkg: PackagingDoc = {
            id: pkgId,
            name: p.name,
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
    }

    posVariants.push({
      id: v.id || `var_${Date.now()}`,
      name: v.name,
      nameTh: v.name,
      price: Number(v.sellingPrice) || 0,
      ingredients: vIngs,
      subRecipes: vSubs,
      packaging: vPkgs,
    });
  }

  // 3. Upsert DishDoc
  const targetDishId = `cost_dish_${normalizePosId(costMenu.id)}`;
  const existingDish = existingDishes.find(
    (d) =>
      d.id === targetDishId ||
      d.name.toLowerCase() === costMenu.name.toLowerCase() ||
      (d.nameTh && d.nameTh.toLowerCase() === costMenu.name.toLowerCase())
  );

  const dishDoc: DishDoc = {
    id: existingDish ? existingDish.id : targetDishId,
    name: costMenu.name,
    nameTh: costMenu.name,
    categoryId: matchedCat.id,
    ...(costMenu.description ? { description: costMenu.description } : {}),
    variants: posVariants.length > 0 ? posVariants : [
      {
        id: `var_std_${Date.now()}`,
        name: 'Standard',
        nameTh: 'มาตรฐาน',
        price: 0,
        ingredients: [],
        subRecipes: [],
        packaging: [],
      },
    ],
    optionGroupIds: existingDish?.optionGroupIds || [],
    order: existingDish?.order || existingDishes.length + 1,
    createdAt: existingDish?.createdAt || now,
    updatedAt: now,
    version: existingDish ? existingDish.version : 1,
  };

  await saveDocument('dishes', dishDoc, !existingDish);
  return {
    dishName: dishDoc.name,
    variantCount: dishDoc.variants.length,
    createdDish: !existingDish,
  };
}
