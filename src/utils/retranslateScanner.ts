import {
  CategoryDoc,
  ChannelDoc,
  DishDoc,
  IngredientDoc,
  OptionGroupDoc,
  PackagingDoc,
  SubRecipeDoc,
} from '../types';
import {
  Ingredient as CostIngredient,
  MenuItem as CostMenuItem,
  Sauce as CostSauce,
} from '../costing/types';
import { containsThaiCharacters, translateThaiToEnglish } from './thaiToEnglish';
import { resolveCostVariantLabel } from '../costing/services/spreadsheetCostHelper';

export type RetranslateEntityType =
  | 'dish'
  | 'dishVariant'
  | 'optionGroup'
  | 'optionChoice'
  | 'category'
  | 'channel'
  | 'ingredient'
  | 'subRecipe'
  | 'packaging'
  | 'costMenu'
  | 'costVariant'
  | 'costIngredient'
  | 'costSauce';

export interface RetranslatePreviewItem {
  key: string;
  entityType: RetranslateEntityType;
  id: string;
  parentId?: string;
  thaiName: string;
  oldEnglish: string;
  newEnglish: string;
}

export interface RetranslateDataset {
  dishes?: DishDoc[];
  optionGroups?: OptionGroupDoc[];
  categories?: CategoryDoc[];
  channels?: ChannelDoc[];
  ingredients?: IngredientDoc[];
  subRecipes?: SubRecipeDoc[];
  packaging?: PackagingDoc[];
  costMenus?: CostMenuItem[];
  costIngredients?: CostIngredient[];
  costSauces?: CostSauce[];
}

export interface RetranslateScanResult {
  items: RetranslatePreviewItem[];
  skippedManualCount: number;
  unresolvedCount: number;
}

function resolvePosThaiSource(name?: string, nameTh?: string): string {
  const th = (nameTh || '').trim();
  if (th && containsThaiCharacters(th)) return th;
  const fallback = (name || '').trim();
  if (fallback && containsThaiCharacters(fallback)) return fallback;
  return '';
}

function resolveCostThaiSource(name?: string, thaiName?: string): string {
  const th = (thaiName || '').trim();
  if (th && containsThaiCharacters(th)) return th;
  const fallback = (name || '').trim();
  if (fallback && containsThaiCharacters(fallback)) return fallback;
  return '';
}

/**
 * Pure scanner (R7): computes all non-manual Thai-named entities whose English translation
 * improves/changes under the current offline dictionary & pattern engine.
 */
export function buildRetranslatePreview(dataset: RetranslateDataset): RetranslateScanResult {
  const items: RetranslatePreviewItem[] = [];
  let skippedManualCount = 0;
  let unresolvedCount = 0;

  const evaluateEntry = (
    entityType: RetranslateEntityType,
    id: string,
    thaiName: string,
    oldEnglish: string,
    isManual: boolean | undefined,
    parentId?: string
  ) => {
    if (!thaiName) return;
    if (isManual) {
      skippedManualCount += 1;
      return;
    }
    const candidate = translateThaiToEnglish(thaiName);
    if (!candidate) {
      unresolvedCount += 1;
      return;
    }
    if (candidate !== oldEnglish) {
      items.push({
        key: parentId ? `${entityType}:${parentId}:${id}` : `${entityType}:${id}`,
        entityType,
        id,
        ...(parentId ? { parentId } : {}),
        thaiName,
        oldEnglish,
        newEnglish: candidate,
      });
    }
  };

  for (const dish of dataset.dishes || []) {
    evaluateEntry(
      'dish',
      dish.id,
      resolvePosThaiSource(dish.name, dish.nameTh),
      (dish.name || '').trim(),
      dish.nameEnManual
    );
    for (const v of dish.variants || []) {
      evaluateEntry(
        'dishVariant',
        v.id,
        resolvePosThaiSource(v.name, v.nameTh),
        (v.name || '').trim(),
        v.nameEnManual,
        dish.id
      );
    }
  }

  for (const grp of dataset.optionGroups || []) {
    evaluateEntry(
      'optionGroup',
      grp.id,
      resolvePosThaiSource(grp.name, grp.nameTh),
      (grp.name || '').trim(),
      grp.nameEnManual
    );
    for (const c of grp.choices || []) {
      evaluateEntry(
        'optionChoice',
        c.id,
        resolvePosThaiSource(c.name, c.nameTh),
        (c.name || '').trim(),
        c.nameEnManual,
        grp.id
      );
    }
  }

  for (const cat of dataset.categories || []) {
    evaluateEntry(
      'category',
      cat.id,
      resolvePosThaiSource(cat.name, cat.nameTh),
      (cat.name || '').trim(),
      cat.nameEnManual
    );
  }

  for (const ch of dataset.channels || []) {
    evaluateEntry(
      'channel',
      ch.id,
      resolvePosThaiSource(ch.name, ch.nameTh),
      (ch.name || '').trim(),
      ch.nameEnManual
    );
  }

  for (const ing of dataset.ingredients || []) {
    evaluateEntry(
      'ingredient',
      ing.id,
      resolvePosThaiSource(ing.name, ing.nameTh),
      (ing.name || '').trim(),
      ing.nameEnManual
    );
  }

  for (const sub of dataset.subRecipes || []) {
    evaluateEntry(
      'subRecipe',
      sub.id,
      resolvePosThaiSource(sub.name, sub.nameTh),
      (sub.name || '').trim(),
      sub.nameEnManual
    );
  }

  for (const pkg of dataset.packaging || []) {
    evaluateEntry(
      'packaging',
      pkg.id,
      resolvePosThaiSource(pkg.name, pkg.nameTh),
      (pkg.name || '').trim(),
      pkg.nameEnManual
    );
  }

  for (const cm of dataset.costMenus || []) {
    evaluateEntry(
      'costMenu',
      cm.id,
      resolveCostThaiSource(cm.name, cm.thaiName),
      (cm.englishName || '').trim(),
      cm.englishNameManual
    );
    for (const cv of cm.variants || []) {
      const thLabel = resolveCostThaiSource(resolveCostVariantLabel(cv), cv.thaiName);
      evaluateEntry(
        'costVariant',
        cv.id,
        thLabel,
        (cv.englishName || '').trim(),
        cv.englishNameManual,
        cm.id
      );
    }
  }

  for (const ci of dataset.costIngredients || []) {
    evaluateEntry(
      'costIngredient',
      ci.id,
      resolveCostThaiSource(ci.name, ci.thaiName),
      (ci.englishName || '').trim(),
      ci.englishNameManual
    );
  }

  for (const cs of dataset.costSauces || []) {
    evaluateEntry(
      'costSauce',
      cs.id,
      resolveCostThaiSource(cs.name, cs.thaiName),
      (cs.englishName || '').trim(),
      cs.englishNameManual
    );
  }

  return { items, skippedManualCount, unresolvedCount };
}
