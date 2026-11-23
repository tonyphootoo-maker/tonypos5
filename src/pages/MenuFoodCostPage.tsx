import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
  DishDoc,
  CategoryDoc,
  ChannelDoc,
  DishVariant,
  OptionGroupDoc,
  SettingsDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import {
  calculateDishVariantCost,
  extractNetPriceFromMenuPrice,
  formatMoney,
} from '../engine/calculations';
import {
  subscribeCollection,
  subscribeDocument,
  saveDocument,
  deleteDocument,
  saveImageDoc,
  getImageDoc,
} from '../data/db';
import { compressImage } from '../utils/imageCompressor';
import {
  translateThaiToEnglish,
  computeAutoEnglishName,
  getLocalizedText,
  containsThaiCharacters,
  resolveEntityEnglishName,
} from '../utils/thaiToEnglish';
import {
  useDebouncedTranslationScheduler,
  needsEnglishReview,
} from '../hooks/useDebouncedThaiTranslation';
import { NumericInput } from '../costing/components/common/NumericInput';
import {
  MenuItem as CostMenuItem,
  MenuVariant as CostMenuVariant,
  Ingredient as CostIngredient,
  Sauce as CostSauce,
  RestaurantSettings as CostRestaurantSettings,
} from '../costing/types';
import { COST_COLLECTIONS } from '../costing/services/firebaseSyncService';
import { StorageService } from '../costing/services/storageService';
import {
  importCostingVariantToDishVariant,
  importCostingIngredientAsDishVariant,
} from '../costing/services/posBridge';
import {
  calculateSpreadsheetRowMetrics,
  resolveCostVariantLabel,
} from '../costing/services/spreadsheetCostHelper';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  UtensilsCrossed,
  Utensils,
  Plus,
  Trash2,
  Edit2,
  Upload,
  CheckCircle2,
  X,
  Search,
  Check,
  ChefHat,
  Sliders,
  ArrowLeft,
  ChevronRight,
  Link2,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { CENTRAL_RECIPE_BUTTON_LABELS } from '../costing/utils/centralRecipeNav';

interface Props {
  settings: SettingsDoc;
  lang: Language;
  initialEditDishRequest?: {
    dishId: string;
    categoryId?: string | null;
    nonce: number;
  } | null;
  onClearEditDishRequest?: () => void;
  onOpenCentralRecipe?: (target: { variantId?: string; menuId?: string }) => void;
}

type TabType = 'dishes' | 'categories' | 'channels';

export const MenuFoodCostPage: React.FC<Props> = ({
  settings,
  lang,
  initialEditDishRequest,
  onClearEditDishRequest,
  onOpenCentralRecipe,
}) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<TabType>('dishes');
  const handledEditNonceRef = useRef<number | null>(null);

  // Master collections
  const [ingredients, setIngredients] = useState<IngredientDoc[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipeDoc[]>([]);
  const [packagings, setPackagings] = useState<PackagingDoc[]>([]);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [channels, setChannels] = useState<ChannelDoc[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [dishImages, setDishImages] = useState<Map<string, string>>(new Map());

  // Search & category filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Modals state

  const [isDishModalOpen, setIsDishModalOpen] = useState(false);
  const [editingDish, setEditingDish] = useState<Partial<DishDoc> | null>(null);
  const [activeDishVariantIndex, setActiveDishVariantIndex] = useState(0);

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Partial<CategoryDoc> | null>(null);

  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Partial<ChannelDoc> | null>(null);

  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editingDishPreviewUrl, setEditingDishPreviewUrl] = useState<string | null>(null);
  const [editingDishImageSizeKb, setEditingDishImageSizeKb] = useState<number | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  // Costing Food-Cost Primary Option Picker & Sub-Option Picker states
  const [costMenus, setCostMenus] = useState<CostMenuItem[]>(() => StorageService.getMenus());
  const [costIngredients, setCostIngredients] = useState<CostIngredient[]>(() =>
    StorageService.getIngredients()
  );
  const [costSauces, setCostSauces] = useState<CostSauce[]>(() => StorageService.getSauces());
  const [costSettings, setCostSettings] = useState<CostRestaurantSettings>(() =>
    StorageService.getSettings()
  );
  const [isPrimaryOptionPickerOpen, setIsPrimaryOptionPickerOpen] = useState(false);
  const [selectedCostMenuId, setSelectedCostMenuId] = useState<string | null>(null);
  const [pickerSourceTab, setPickerSourceTab] = useState<'menus' | 'ingredients'>('menus');
  const [primaryOptionSearch, setPrimaryOptionSearch] = useState('');
  const [isImportingCostOption, setIsImportingCostOption] = useState(false);
  const [isOptionGroupPickerOpen, setIsOptionGroupPickerOpen] = useState(false);
  const [optionGroupSearch, setOptionGroupSearch] = useState('');
  const [modalPriceOverrides, setModalPriceOverrides] = useState<Record<string, number>>({});
  const [pendingDelete, setPendingDelete] = useState<{
    type: 'dish' | 'category' | 'channel';
    id: string;
    label: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Tracks which English inputs were manually customized in the current modal session
  const manualEnKeysRef = useRef<Set<string>>(new Set());
  const prevDishThaiRef = useRef<string>('');
  const prevVarThaiMapRef = useRef<Map<string, string>>(new Map());
  const prevCatThaiRef = useRef<string>('');
  const prevChThaiRef = useRef<string>('');
  const translationScheduler = useDebouncedTranslationScheduler(600);
  const loadedDishImageIdsRef = useRef<Map<string, string>>(new Map());
  const dishFormRef = useRef<HTMLFormElement | null>(null);
  const dishModalSnapshotRef = useRef<string>('');
  const [dishModalError, setDishModalError] = useState<string | null>(null);
  const [pendingRecipeNavTarget, setPendingRecipeNavTarget] = useState<{
    variantId?: string;
    menuId?: string;
  } | null>(null);
  const [isNavigatingToRecipe, setIsNavigatingToRecipe] = useState<boolean>(false);

  const serializeDishModalDraft = (
    dish: Partial<DishDoc> | null,
    overrides: Record<string, number>
  ) => {
    if (!dish) return '';
    return JSON.stringify({
      id: dish.id || '',
      name: dish.name || '',
      nameTh: dish.nameTh || '',
      categoryId: dish.categoryId || '',
      imageId: dish.imageId || '',
      description: dish.description || '',
      costMenuId: dish.costMenuId || '',
      optionGroupIds: dish.optionGroupIds || [],
      variants: (dish.variants || []).map((v) => ({
        id: v.id,
        name: v.name || '',
        nameTh: v.nameTh || '',
        price: Number(v.price) || 0,
        costMenuId: v.costMenuId || '',
        costVariantId: v.costVariantId || '',
      })),
      overrides,
    });
  };

  const isDishModalDirty = useMemo(() => {
    if (!isDishModalOpen || !editingDish) return false;
    return (
      serializeDishModalDraft(editingDish, modalPriceOverrides) !==
      dishModalSnapshotRef.current
    );
  }, [isDishModalOpen, editingDish, modalPriceOverrides]);

  const closeDishModalCleanly = () => {
    translationScheduler.cancelAll();
    setIsDishModalOpen(false);
    setEditingDish(null);
    setEditingDishPreviewUrl(null);
    setEditingDishImageSizeKb(null);
    setImageUploadError(null);
    setDishModalError(null);
    setPendingRecipeNavTarget(null);
    setIsNavigatingToRecipe(false);
  };

  // No-ops kept for existing handler call sites since real-time listeners handle updates
  const loadCostingCatalog = async () => {};
  const loadData = async () => {};

  useEffect(() => {
    const unsubs = [
      subscribeCollection<IngredientDoc>('ingredients', (ings) => setIngredients(ings)),
      subscribeCollection<SubRecipeDoc>('subRecipes', (subs) => setSubRecipes(subs)),
      subscribeCollection<PackagingDoc>('packaging', (pkgs) => setPackagings(pkgs)),
      subscribeCollection<CategoryDoc>('categories', (cats) =>
        setCategories([...cats].sort((a, b) => (a.order || 0) - (b.order || 0)))
      ),
      subscribeCollection<ChannelDoc>('channels', (chs) => setChannels(chs)),
      subscribeCollection<OptionGroupDoc>('optionGroups', (ogs) =>
        setOptionGroups([...ogs].sort((a, b) => (a.order || 0) - (b.order || 0)))
      ),
      subscribeCollection<DishDoc>('dishes', (dshs) => {
        const sortedDishes = [...dshs].sort((a, b) => (a.order || 0) - (b.order || 0));
        setDishes(sortedDishes);

        const activeIds = new Set(sortedDishes.map((item) => item.id));
        loadedDishImageIdsRef.current.forEach((_, dishId) => {
          if (!activeIds.has(dishId)) {
            loadedDishImageIdsRef.current.delete(dishId);
          }
        });

        sortedDishes.forEach((d) => {
          if (d.imageId) {
            if (loadedDishImageIdsRef.current.get(d.id) !== d.imageId) {
              loadedDishImageIdsRef.current.set(d.id, d.imageId);
              getImageDoc(d.imageId).then((imgDoc) => {
                if (imgDoc?.dataUrl) {
                  setDishImages((prev) => new Map(prev).set(d.id, imgDoc.dataUrl));
                }
              });
            }
          } else if (loadedDishImageIdsRef.current.has(d.id)) {
            loadedDishImageIdsRef.current.delete(d.id);
            setDishImages((prev) => {
              const next = new Map(prev);
              next.delete(d.id);
              return next;
            });
          }
        });
      }),
      subscribeCollection<CostMenuItem>(COST_COLLECTIONS.MENUS, (cloudMenus) => {
        if (cloudMenus.length > 0) {
          setCostMenus([...cloudMenus].sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)));
        }
      }),
      subscribeCollection<CostIngredient>(COST_COLLECTIONS.INGREDIENTS, (cloudIngs) => {
        if (cloudIngs.length > 0) setCostIngredients(cloudIngs);
      }),
      subscribeCollection<CostSauce>(COST_COLLECTIONS.SAUCES, (cloudSauces) => {
        if (cloudSauces.length > 0) setCostSauces(cloudSauces);
      }),
      subscribeDocument<CostRestaurantSettings>(COST_COLLECTIONS.SETTINGS, 'default', (cloudSet) => {
        if (cloudSet) setCostSettings(cloudSet);
      }),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, []);

  // Compute live Maps for dynamic fallback & Food Cost linkage
  const ingredientsMap = useMemo(
    () => new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i])),
    [ingredients]
  );
  const subRecipesMap = useMemo(
    () => new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s])),
    [subRecipes]
  );
  const packagingMap = useMemo(
    () => new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p])),
    [packagings]
  );
  const costIngMap = useMemo(
    () => new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i])),
    [costIngredients]
  );
  const costSauceMap = useMemo(
    () => new Map<string, CostSauce>(costSauces.map((s) => [s.id, s])),
    [costSauces]
  );

  const getActiveCostVariants = (menu: CostMenuItem): CostMenuVariant[] => {
    return menu.variants || [];
  };

  const getCostVariantLabel = (cv: CostMenuVariant): string => resolveCostVariantLabel(cv);

  const stripDishPrefix = (raw: string): string =>
    raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/^(ข้าวผัด|ผัด|ข้าว|ต้มยำ|ต้ม|แกง|ยำ|ทอด|น้ำ|เมนู)/, '');

  const findMatchingCostMenu = (dish: Partial<DishDoc>): CostMenuItem | null => {
    const activeCostMenus = costMenus.filter((m) => m.active !== false);
    if (activeCostMenus.length === 0) return null;

    if (dish.costMenuId) {
      const byId = activeCostMenus.find((m) => m.id === dish.costMenuId);
      if (byId) return byId;
    }

    const varCostMenuId = dish.variants?.find((v) => v.costMenuId)?.costMenuId;
    if (varCostMenuId) {
      const byVarMenuId = activeCostMenus.find((m) => m.id === varCostMenuId);
      if (byVarMenuId) return byVarMenuId;
    }

    if (dish.id?.startsWith('cost_dish_')) {
      const normalizedCostId = dish.id.replace('cost_dish_', '');
      const byNorm = activeCostMenus.find(
        (m) => m.id.replace(/[^a-zA-Z0-9_-]/g, '_') === normalizedCostId
      );
      if (byNorm) return byNorm;
    }

    const dTh = (dish.nameTh || '').trim().toLowerCase();
    const dEn = (dish.name || '').trim().toLowerCase();
    if (!dTh && !dEn) return null;

    // 1. Exact lowercase match
    const exact = activeCostMenus.find((m) => {
      const mName = m.name.trim().toLowerCase();
      return (dTh && mName === dTh) || (dEn && mName === dEn);
    });
    if (exact) return exact;

    // 2. Normalized Thai dish prefix match (e.g. "ผัดกะเพรา" / "ข้าวกะเพรา" -> "กะเพรา")
    const dThNorm = stripDishPrefix(dTh);
    if (dThNorm.length >= 2) {
      const normMatch = activeCostMenus.find((m) => {
        const mNorm = stripDishPrefix(m.name);
        return mNorm.length >= 2 && mNorm === dThNorm;
      });
      if (normMatch) return normMatch;
    }

    // 3. Partial match: prefer menu name included inside dish name (longest match first)
    if (dTh.length >= 2) {
      const containedInDish = activeCostMenus
        .filter((m) => {
          const mName = m.name.trim().toLowerCase();
          return mName.length >= 2 && dTh.includes(mName);
        })
        .sort((a, b) => b.name.trim().length - a.name.trim().length);
      if (containedInDish.length > 0) return containedInDish[0];

      // Otherwise shortest menu name that contains the dish name
      const containingDish = activeCostMenus
        .filter((m) => {
          const mName = m.name.trim().toLowerCase();
          return mName.length >= 2 && mName.includes(dTh);
        })
        .sort((a, b) => a.name.trim().length - b.name.trim().length);
      if (containingDish.length > 0) return containingDish[0];
    }

    if (dEn.length >= 2) {
      const enCandidates = activeCostMenus
        .filter((m) => {
          const mName = m.name.trim().toLowerCase();
          return mName.length >= 2 && (dEn.includes(mName) || mName.includes(dEn));
        })
        .sort((a, b) => a.name.trim().length - b.name.trim().length);
      if (enCandidates.length > 0) return enCandidates[0];
    }

    return null;
  };

  const findExistingPosVariantForCostVariant = (
    cv: CostMenuVariant,
    posVariants: DishVariant[] = []
  ): DishVariant | undefined => {
    const byId = posVariants.find((pv) => pv.costVariantId === cv.id || pv.id === cv.id);
    if (byId) return byId;

    const cLabel = getCostVariantLabel(cv).toLowerCase();
    const cProt = (cv.proteinType || '').trim().toLowerCase();
    const cName = (cv.thaiName || cv.name || '').trim().toLowerCase();
    const cEn = (cv.englishName || '').trim().toLowerCase();

    return posVariants.find((pv) => {
      const pTh = (pv.nameTh || '').trim().toLowerCase();
      const pEn = (pv.name || '').trim().toLowerCase();
      if (!pTh && !pEn) return false;
      if (pTh === 'มาตรฐาน' || pEn === 'standard') return false;
      return (
        (pTh && (pTh === cLabel || pTh === cProt || pTh === cName)) ||
        (pEn && (pEn === cLabel || pEn === cProt || pEn === cName || (cEn && pEn === cEn)))
      );
    });
  };

  const resolveCostVariantSellingPrice = (
    costMenu: CostMenuItem,
    cv: CostMenuVariant,
    existingMatched?: DishVariant,
    sessionOverride?: number
  ): number => {
    if (sessionOverride !== undefined) return sessionOverride;

    const spreadsheetBase = calculateSpreadsheetRowMetrics({
      menu: costMenu,
      variant: cv,
      ingredientsMap: costIngMap,
      servingMode: 'ON_RICE',
    }).baseSellingPrice;

    if (existingMatched && existingMatched.price > 0) {
      const isLegacyRawKaprowSeed =
        (costMenu.name.includes('กะเพรา') ||
          costMenu.id === 'menu_kaprow' ||
          cv.menuId === 'menu_kaprow') &&
        existingMatched.price === (Number(cv.sellingPrice) || 0) &&
        spreadsheetBase !== (Number(cv.sellingPrice) || 0);
      if (!isLegacyRawKaprowSeed) {
        return existingMatched.price;
      }
    }

    return spreadsheetBase;
  };

  const computeCostVariantRealtimeBreakdown = (
    costMenu: CostMenuItem,
    cv: CostMenuVariant,
    sellingPriceOverride?: number
  ) => {
    return calculateSpreadsheetRowMetrics({
      menu: costMenu,
      variant: cv,
      ingredientsMap: costIngMap,
      servingMode: 'ON_RICE',
      sellingPriceOverride,
    });
  };

  const matchedEditingCostMenu = useMemo(
    () => (editingDish ? findMatchingCostMenu(editingDish) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingDish, costMenus]
  );

  const handleUpdateCostVariantPrice = (
    costMenu: CostMenuItem,
    cv: CostMenuVariant,
    newPrice: number
  ) => {
    if (!editingDish) return;
    setModalPriceOverrides((prev) => ({ ...prev, [cv.id]: newPrice }));

    const labelTh = getCostVariantLabel(cv);
    const currentVariants = editingDish.variants || [];
    const existingMatched = findExistingPosVariantForCostVariant(cv, currentVariants);

    const strippedPlaceholder = currentVariants.filter((pv) => {
      if (currentVariants.length > 1) return true;
      const pTh = (pv.nameTh || '').trim().toLowerCase();
      const pEn = (pv.name || '').trim().toLowerCase();
      return !(
        (pTh === 'มาตรฐาน' || pEn === 'standard') &&
        !pv.costVariantId &&
        (pv.ingredients?.length || 0) === 0
      );
    });

    const labelEn = resolveEntityEnglishName(labelTh, cv.englishName) || labelTh;
    let updatedVariants: DishVariant[];
    if (existingMatched) {
      updatedVariants = strippedPlaceholder.map((pv) =>
        pv.id === existingMatched.id
          ? {
              ...pv,
              nameTh: labelTh,
              name: labelEn,
              nameEnManual: Boolean(cv.englishNameManual || pv.nameEnManual),
              price: newPrice,
              costMenuId: costMenu.id,
              costVariantId: cv.id,
            }
          : pv
      );
    } else {
      updatedVariants = [
        ...strippedPlaceholder,
        {
          id: cv.id || `var_${Date.now()}`,
          nameTh: labelTh,
          name: labelEn,
          nameEnManual: Boolean(cv.englishNameManual),
          price: newPrice,
          costMenuId: costMenu.id,
          costVariantId: cv.id,
          ingredients: [],
          subRecipes: [],
          packaging: [],
        },
      ];
    }

    setEditingDish({
      ...editingDish,
      costMenuId: costMenu.id,
      variants: updatedVariants,
    });
  };

  // Resolve real-time Cost, Dine-In Profit, and Takeaway Profit linked with Food Cost ("ต้นทุนอาหาร")
  const getLinkedFoodCostMetrics = (dish: Partial<DishDoc>, variant?: DishVariant) => {
    const activeCostMenus = costMenus.filter((m) => m.active !== false);

    const findCostMatch = (): { menu: CostMenuItem; variant: CostMenuVariant } | null => {
      if (activeCostMenus.length === 0) return null;

      // 1. Direct ID match on variant
      if (variant?.costVariantId) {
        if (variant.costMenuId || dish.costMenuId) {
          const targetMenu = activeCostMenus.find(
            (m) => m.id === (variant.costMenuId || dish.costMenuId)
          );
          const targetVar = targetMenu?.variants?.find(
            (cv) => cv.id === variant.costVariantId && cv.active !== false
          );
          if (targetMenu && targetVar) return { menu: targetMenu, variant: targetVar };
        }
        for (const cm of activeCostMenus) {
          const cv = (cm.variants || []).find(
            (x) => x.id === variant.costVariantId && x.active !== false
          );
          if (cv) return { menu: cm, variant: cv };
        }
      }

      // 2. Shared variant ID (from syncCostingMenuToPOS)
      if (variant?.id) {
        for (const cm of activeCostMenus) {
          const cv = (cm.variants || []).find(
            (x) => x.id === variant.id && x.active !== false
          );
          if (cv) return { menu: cm, variant: cv };
        }
      }

      // 3. Match CostMenu at dish level
      const matchedMenu = findMatchingCostMenu(dish) || undefined;

      if (matchedMenu && (matchedMenu.variants || []).length > 0) {
        const pool = getActiveCostVariants(matchedMenu);

        if (!variant) {
          return { menu: matchedMenu, variant: pool[0] };
        }

        const vTh = (variant.nameTh || '').trim().toLowerCase();
        const vEn = (variant.name || '').trim().toLowerCase();

        const exactVar = pool.find((cv) => {
          const p = (cv.proteinType || '').trim().toLowerCase();
          const n = (cv.thaiName || cv.name || '').trim().toLowerCase();
          const e = (cv.englishName || '').trim().toLowerCase();
          return (
            (vTh && (p === vTh || n === vTh)) ||
            (vEn && (p === vEn || n === vEn || (e && e === vEn)))
          );
        });
        if (exactVar) return { menu: matchedMenu, variant: exactVar };

        if (vTh === 'มาตรฐาน' || vEn === 'standard') {
          return { menu: matchedMenu, variant: pool[0] };
        }

        const partialVar = pool.find((cv) => {
          const p = (cv.proteinType || '').trim().toLowerCase();
          const n = (cv.thaiName || cv.name || '').trim().toLowerCase();
          return (
            (vTh.length >= 2 && (n.includes(vTh) || p.includes(vTh) || (p && vTh.includes(p)))) ||
            (vEn.length >= 2 && (n.includes(vEn) || p.includes(vEn)))
          );
        });
        if (partialVar) return { menu: matchedMenu, variant: partialVar };

        if (pool.length === 1) {
          return { menu: matchedMenu, variant: pool[0] };
        }
      }

      // 4. Cross-menu search when a POS dish variant combines dish + protein name
      if (variant) {
        const dTh = (dish.nameTh || '').trim().toLowerCase();
        const vTh = (variant.nameTh || '').trim().toLowerCase();
        const combinedTh = `${dTh} ${vTh}`.trim();
        for (const cm of activeCostMenus) {
          const cmName = cm.name.trim().toLowerCase();
          for (const cv of cm.variants || []) {
            if (cv.active === false) continue;
            const cvName = (cv.name || '').trim().toLowerCase();
            const cvProt = (cv.proteinType || '').trim().toLowerCase();
            if (
              (combinedTh && cvName === combinedTh) ||
              (dTh && vTh && cmName.includes(dTh) && (cvProt === vTh || cvName.includes(vTh)))
            ) {
              return { menu: cm, variant: cv };
            }
          }
        }
      }

      return null;
    };

    const match = findCostMatch();
    if (match) {
      const posPrice = resolveCostVariantSellingPrice(match.menu, match.variant, variant);
      const breakdown = computeCostVariantRealtimeBreakdown(match.menu, match.variant, posPrice);

      return {
        hasData: true,
        source: 'food_cost' as const,
        matchedMenuId: match.menu.id,
        matchedVariantId: match.variant.id,
        matchedMenuName: match.menu.name,
        matchedVariantName: getCostVariantLabel(match.variant),
        cost: breakdown.totalCost,
        foodCostPercent: breakdown.fcPercent,
        ingredientCost: breakdown.totalRawMaterialCost,
        dineInProfit: breakdown.dineInProfit,
        takeawayProfit: breakdown.takeawayProfit,
      };
    }

    // Fallback: POS variant has local recipe items linked
    if (variant) {
      const posCalc = calculateDishVariantCost(
        variant,
        ingredientsMap,
        subRecipesMap,
        packagingMap
      );
      if (posCalc.hasRecipe) {
        const posPrice = variant.price || 0;
        const netDineIn = extractNetPriceFromMenuPrice(
          posPrice,
          settings.pricesIncludeVat,
          settings.vatPercent,
          settings.serviceChargeIncludedInPrice,
          settings.serviceChargePercent
        );
        const takeawayChannel = channels.find((c) => c.type === 'takeaway');
        const takeawayPrice =
          takeawayChannel?.priceMarkupPercent
            ? posPrice * (1 + takeawayChannel.priceMarkupPercent / 100)
            : posPrice;
        const netTakeaway = extractNetPriceFromMenuPrice(
          takeawayPrice,
          settings.pricesIncludeVat,
          settings.vatPercent,
          settings.serviceChargeIncludedInPrice,
          settings.serviceChargePercent
        );
        const takeawayBoxCost =
          takeawayChannel?.packagingCost ?? costSettings.takeawayPackagingCost ?? 0;

        return {
          hasData: true,
          source: 'pos_recipe' as const,
          matchedMenuId: '',
          matchedVariantId: '',
          matchedMenuName: dish.nameTh || dish.name || '',
          matchedVariantName: variant.nameTh || variant.name,
          cost: posCalc.totalCost,
          foodCostPercent: netDineIn > 0 ? (posCalc.foodCost / netDineIn) * 100 : 0,
          ingredientCost: posCalc.foodCost,
          dineInProfit: netDineIn - posCalc.totalCost,
          takeawayProfit: netTakeaway - (posCalc.totalCost + takeawayBoxCost),
        };
      }
    }

    return {
      hasData: false,
      source: 'none' as const,
      matchedMenuId: '',
      matchedVariantId: '',
      matchedMenuName: '',
      matchedVariantName: '',
      cost: 0,
      foodCostPercent: 0,
      ingredientCost: 0,
      dineInProfit: 0,
      takeawayProfit: 0,
    };
  };

  const openEditDish = (dish: DishDoc) => {
    translationScheduler.cancelAll();
    manualEnKeysRef.current.clear();
    if (dish.nameEnManual && (dish.name || '').trim()) {
      manualEnKeysRef.current.add('dish');
    }
    prevDishThaiRef.current = dish.nameTh || '';
    prevVarThaiMapRef.current = new Map(
      (dish.variants || []).map((v) => [v.id, v.nameTh || ''])
    );
    (dish.variants || []).forEach((v) => {
      if (v.nameEnManual && (v.name || '').trim()) {
        manualEnKeysRef.current.add(`var_${v.id}`);
      }
    });
    setModalPriceOverrides({});
    setImageUploadError(null);
    setEditingDishImageSizeKb(null);
    const existingImg = dishImages.get(dish.id) || null;
    setEditingDishPreviewUrl(existingImg);
    if (dish.imageId) {
      getImageDoc(dish.imageId)
        .then((imgDoc) => {
          if (imgDoc?.dataUrl) {
            setEditingDishPreviewUrl(imgDoc.dataUrl);
            setDishImages((prev) => new Map(prev).set(dish.id, imgDoc.dataUrl));
            if (imgDoc.sizeBytes) {
              setEditingDishImageSizeKb(Math.max(1, Math.round(imgDoc.sizeBytes / 1024)));
            }
          }
        })
        .catch(() => {});
    }
    const draftDish: Partial<DishDoc> = {
      ...dish,
      variants: (dish.variants || []).map((v) => ({
        ...v,
        ingredients: [...(v.ingredients || [])],
        subRecipes: [...(v.subRecipes || [])],
        packaging: [...(v.packaging || [])],
      })),
      optionGroupIds: [...(dish.optionGroupIds || [])],
    };
    dishModalSnapshotRef.current = serializeDishModalDraft(draftDish, {});
    setDishModalError(null);
    setPendingRecipeNavTarget(null);
    setIsNavigatingToRecipe(false);
    setEditingDish(draftDish);
    setActiveDishVariantIndex(0);
    loadCostingCatalog();
    setIsDishModalOpen(true);
  };

  useEffect(() => {
    if (!initialEditDishRequest || dishes.length === 0) return;
    if (handledEditNonceRef.current === initialEditDishRequest.nonce) return;

    const targetDish = dishes.find((d) => d.id === initialEditDishRequest.dishId);
    if (!targetDish) return;

    handledEditNonceRef.current = initialEditDishRequest.nonce;
    setActiveTab('dishes');
    if (initialEditDishRequest.categoryId && initialEditDishRequest.categoryId !== 'all') {
      setSelectedCategoryId(initialEditDishRequest.categoryId);
    } else if (targetDish.categoryId) {
      setSelectedCategoryId(targetDish.categoryId);
    }
    openEditDish(targetDish);
    onClearEditDishRequest?.();
  }, [initialEditDishRequest, dishes]);

  // ==========================================
  // DISH & RECIPE HANDLERS
  // ==========================================
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !editingDish) return;

    setIsUploadingImage(true);
    setImageUploadError(null);
    try {
      const { dataUrl, sizeBytes } = await compressImage(file);
      const imageId = `img_${Date.now()}`;
      await saveImageDoc(imageId, dataUrl, sizeBytes);

      setEditingDish((prev) => (prev ? { ...prev, imageId } : prev));
      setEditingDishPreviewUrl(dataUrl);
      setEditingDishImageSizeKb(Math.max(1, Math.round(sizeBytes / 1024)));
      if (editingDish.id) {
        loadedDishImageIdsRef.current.set(editingDish.id, imageId);
        setDishImages((prev) => new Map(prev).set(editingDish.id!, dataUrl));
      }
    } catch (err) {
      console.error('Image compression error:', err);
      setImageUploadError(
        lang === 'th'
          ? 'อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองไฟล์อื่น'
          : 'Failed to upload image. Please try another file.'
      );
    } finally {
      setIsUploadingImage(false);
      input.value = '';
    }
  };

  const saveDishFromModal = async (): Promise<{ ok: boolean; savedDish?: DishDoc }> => {
    if (!editingDish) return { ok: false };

    translationScheduler.cancelAll();
    const finalDishTh = (editingDish.nameTh || '').trim();
    const isDishManual =
      manualEnKeysRef.current.has('dish') && Boolean((editingDish.name || '').trim());
    const computedDishEn = isDishManual
      ? (editingDish.name || '').trim()
      : computeAutoEnglishName({
          previousThai: prevDishThaiRef.current,
          nextThai: finalDishTh,
          currentEnglish: editingDish.name || '',
          isManuallyEdited: false,
        }) || (finalDishTh ? translateThaiToEnglish(finalDishTh) : '');
    const finalDishEn = computedDishEn.trim();
    if (!finalDishEn && !finalDishTh) {
      setDishModalError(
        lang === 'th' ? 'กรุณาระบุชื่อเมนูอาหารก่อนบันทึก' : 'Please enter a dish name before saving.'
      );
      dishFormRef.current?.reportValidity();
      return { ok: false };
    }
    setDishModalError(null);

    const matchedCostMenu = findMatchingCostMenu(editingDish);

    const normalizedVariants: DishVariant[] = matchedCostMenu
      ? getActiveCostVariants(matchedCostMenu).map((cv) => {
          const existingMatched = findExistingPosVariantForCostVariant(
            cv,
            editingDish.variants || []
          );
          const vTh = getCostVariantLabel(cv);
          const vEn =
            resolveEntityEnglishName(vTh, cv.englishName) ||
            (existingMatched?.name &&
            existingMatched.name !== 'Standard' &&
            !containsThaiCharacters(existingMatched.name)
              ? existingMatched.name.trim()
              : '') ||
            vTh;
          const resolvedPrice = resolveCostVariantSellingPrice(
            matchedCostMenu,
            cv,
            existingMatched,
            modalPriceOverrides[cv.id]
          );
          return {
            id: existingMatched?.id || cv.id || `var_${Date.now()}`,
            name: vEn,
            nameTh: vTh,
            nameEnManual: Boolean(cv.englishNameManual || existingMatched?.nameEnManual),
            price: resolvedPrice,
            costMenuId: matchedCostMenu.id,
            costVariantId: cv.id,
            ingredients: existingMatched?.ingredients || [],
            subRecipes: existingMatched?.subRecipes || [],
            packaging: existingMatched?.packaging || [],
          };
        })
      : (editingDish.variants || []).map((v) => {
          const vTh = (v.nameTh || '').trim();
          const isVarManual =
            manualEnKeysRef.current.has(`var_${v.id}`) && Boolean((v.name || '').trim());
          const vEn = isVarManual
            ? (v.name || '').trim()
            : computeAutoEnglishName({
                previousThai: prevVarThaiMapRef.current.get(v.id) ?? vTh,
                nextThai: vTh,
                currentEnglish: v.name || '',
                isManuallyEdited: false,
              }) ||
              (vTh ? translateThaiToEnglish(vTh) : '') ||
              'Standard';
          return {
            ...v,
            name: vEn,
            nameEnManual: isVarManual,
            ...(vTh ? { nameTh: vTh } : {}),
            price: Number(v.price) || 0,
            ingredients: v.ingredients || [],
            subRecipes: v.subRecipes || [],
            packaging: v.packaging || [],
          };
        });

    const isNew = !editingDish.id;
    const resolvedCostMenuId = matchedCostMenu?.id || editingDish.costMenuId;
    const dishToSave: DishDoc = {
      id: editingDish.id || `dish_${Date.now()}`,
      name: finalDishEn || finalDishTh,
      nameEnManual: isDishManual,
      ...(finalDishTh ? { nameTh: finalDishTh } : {}),
      categoryId: editingDish.categoryId || categories[0]?.id || 'cat_main',
      ...(editingDish.imageId ? { imageId: editingDish.imageId } : {}),
      ...(editingDish.description ? { description: editingDish.description } : {}),
      ...(resolvedCostMenuId ? { costMenuId: resolvedCostMenuId } : {}),
      variants: normalizedVariants.length ? normalizedVariants : [
        {
          id: `var_std_${Date.now()}`,
          name: 'Standard',
          nameTh: 'มาตรฐาน',
          price: 100,
          ingredients: [],
          subRecipes: [],
          packaging: [],
        },
      ],
      optionGroupIds: editingDish.optionGroupIds || [],
      order: editingDish.order || dishes.length + 1,
      createdAt: editingDish.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingDish.version || 1,
    };

    try {
      await saveDocument('dishes', dishToSave, isNew);
      if (editingDishPreviewUrl) {
        if (dishToSave.imageId) {
          loadedDishImageIdsRef.current.set(dishToSave.id, dishToSave.imageId);
        }
        setDishImages((prev) => new Map(prev).set(dishToSave.id, editingDishPreviewUrl));
      } else if (!dishToSave.imageId) {
        loadedDishImageIdsRef.current.delete(dishToSave.id);
        setDishImages((prev) => {
          const next = new Map(prev);
          next.delete(dishToSave.id);
          return next;
        });
      }
      closeDishModalCleanly();
      loadData();
      return { ok: true, savedDish: dishToSave };
    } catch (err) {
      setDishModalError(
        err instanceof Error
          ? err.message
          : lang === 'th'
          ? 'บันทึกเมนูไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
          : 'Failed to save dish. Please try again.'
      );
      return { ok: false };
    }
  };

  const handleSaveDish = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveDishFromModal();
  };

  const filteredDishes = dishes.filter((d) => {
    const matchesCategory = !selectedCategoryId || d.categoryId === selectedCategoryId;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      d.name.toLowerCase().includes(q) ||
      (d.nameTh && d.nameTh.toLowerCase().includes(q));
    return matchesCategory && matchesSearch;
  });

  const activeCategoryObj = selectedCategoryId
    ? categories.find((c) => c.id === selectedCategoryId) || null
    : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden select-none">
      {/* Top Header & Tab Chips */}
      <div className="shrink-0 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-3 sm:pt-4 pb-2 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <h2 className="text-lg sm:text-xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-orange-600" />
            <span>{t.menuCost.title}</span>
          </h2>

          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2" />
            <input
              type="text"
              placeholder={t.common.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* Tab Navigation Chips (POS Front-of-House Only) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-orange-200">
          {[
            { id: 'dishes', label: t.menuCost.tabDishes, count: dishes.length },
            { id: 'categories', label: t.menuCost.tabCategories, count: categories.length },
            { id: 'channels', label: t.menuCost.tabChannels, count: channels.length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap shadow-2xs active:scale-95 ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-xs'
                  : 'bg-white text-neutral-700 hover:bg-orange-50/60 border border-neutral-200'
              }`}
            >
              {tab.label} <span className="opacity-80">({tab.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Main Content Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4">
        <div className="max-w-7xl mx-auto">
      {/* ========================================================= */}
      {/* TAB: MENU ITEMS (POS FRONT-OF-HOUSE — COMPACT 40% SMALLER CARDS) */}
      {/* ========================================================= */}
      {activeTab === 'dishes' && (
        <div className="space-y-2.5">
          <div className="flex justify-between items-center gap-2">
            <span className="text-xs font-bold text-neutral-600 truncate">
              {activeCategoryObj
                ? `${lang === 'th' && activeCategoryObj.nameTh ? activeCategoryObj.nameTh : activeCategoryObj.name}: ${filteredDishes.length} ${lang === 'th' ? 'เมนู' : 'dishes'}`
                : `${lang === 'th' ? 'ทั้งหมด' : 'Showing'} ${filteredDishes.length} ${lang === 'th' ? 'เมนู' : 'dishes'}`}
            </span>
            <button
              onClick={() => {
                translationScheduler.cancelAll();
                manualEnKeysRef.current.clear();
                prevDishThaiRef.current = '';
                prevVarThaiMapRef.current = new Map();
                setModalPriceOverrides({});
                setEditingDishPreviewUrl(null);
                setEditingDishImageSizeKb(null);
                setImageUploadError(null);
                const draftNewDish: Partial<DishDoc> = {
                  name: '',
                  nameTh: '',
                  categoryId: selectedCategoryId || categories[0]?.id || 'cat_main',
                  variants: [
                    {
                      id: `var_${Date.now()}`,
                      name: 'Standard',
                      nameTh: 'มาตรฐาน',
                      price: 0,
                      ingredients: [],
                      subRecipes: [],
                      packaging: [],
                    },
                  ],
                  optionGroupIds: [],
                };
                dishModalSnapshotRef.current = serializeDishModalDraft(draftNewDish, {});
                setDishModalError(null);
                setPendingRecipeNavTarget(null);
                setIsNavigatingToRecipe(false);
                setEditingDish(draftNewDish);
                setActiveDishVariantIndex(0);
                loadCostingCatalog();
                setIsDishModalOpen(true);
              }}
              className="px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.menuCost.addDish}</span>
            </button>
          </div>

          {filteredDishes.length === 0 ? (
            <div className="p-8 bg-white rounded-2xl border border-dashed border-neutral-300 text-center text-xs text-neutral-500">
              {lang === 'th' ? 'ไม่พบเมนูอาหารในหมวดหมู่นี้' : 'No menu items in this category'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {filteredDishes.map((dish) => {
                const imgDataUrl = dishImages.get(dish.id);
                const matchedCostMenu = findMatchingCostMenu(dish);
                const activeCostVars = matchedCostMenu ? getActiveCostVariants(matchedCostMenu) : [];
                const firstCostVar = activeCostVars[0];
                const matchedPosFirstVar = firstCostVar
                  ? findExistingPosVariantForCostVariant(firstCostVar, dish.variants || [])
                  : dish.variants[0];
                const previewVariant = matchedPosFirstVar || dish.variants[0];
                const metrics = getLinkedFoodCostMetrics(dish, previewVariant);
                const catObj = categories.find((c) => c.id === dish.categoryId);
                const catLabel = lang === 'th' && catObj?.nameTh ? catObj.nameTh : catObj?.name || 'ทั่วไป';
                const displayPrice =
                  matchedCostMenu && firstCostVar
                    ? resolveCostVariantSellingPrice(matchedCostMenu, firstCostVar, matchedPosFirstVar)
                    : matchedPosFirstVar?.price && matchedPosFirstVar.price > 0
                    ? matchedPosFirstVar.price
                    : dish.variants[0]?.price ?? 0;
                const optionCount = activeCostVars.length > 0 ? activeCostVars.length : dish.variants.length;

                return (
                  <div
                    key={dish.id}
                    onDoubleClick={() => openEditDish(dish)}
                    title={lang === 'th' ? 'ดับเบิลคลิกเพื่อแก้ไขเมนู' : 'Double-click to edit menu'}
                    className="p-2 bg-white rounded-xl border border-neutral-200 shadow-xs hover:shadow-md hover:border-orange-300 transition-all flex flex-col justify-between cursor-pointer"
                  >
                    <div>
                      {/* Compact Photo & Title (Reduced ~40%) */}
                      <div className="flex items-start gap-2 mb-1.5">
                        <div className="w-10 h-10 rounded-lg bg-neutral-100 overflow-hidden shrink-0 border border-neutral-200 flex items-center justify-center">
                          {imgDataUrl ? (
                            <img
                              src={imgDataUrl}
                              alt={dish.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Utensils className="w-4 h-4 text-neutral-300" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              openEditDish(dish);
                            }}
                            title={lang === 'th' ? 'ดับเบิลคลิกที่ชื่อเมนูเพื่อแก้ไข' : 'Double-click dish name to edit'}
                            className="font-black text-xs text-neutral-900 hover:text-orange-600 transition-colors truncate leading-tight cursor-pointer"
                          >
                            {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                          </h4>
                          <p className="text-[10px] text-neutral-500 truncate leading-tight mt-0.5">
                            {catLabel}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            <span className="text-[11px] font-black text-orange-600 leading-none">
                              ฿{formatMoney(displayPrice)}
                            </span>
                            {optionCount > 1 && (
                              <span className="text-[9px] text-neutral-500 font-semibold leading-none">
                                ({optionCount})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Compact Real Cost & Profits Linked from Food Cost */}
                      <div className="p-1.5 bg-neutral-50 rounded-lg border border-neutral-100 space-y-1">
                        {!metrics.hasData ? (
                          <div className="py-1 px-1 text-center text-[9px] font-semibold text-neutral-400 truncate">
                            {lang === 'th' ? 'ยังไม่เชื่อมต้นทุน' : 'Unlinked'}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-1 text-[9px] text-neutral-500">
                              <span className="inline-flex items-center gap-0.5 font-bold text-emerald-700 truncate">
                                <Link2 className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">
                                  {metrics.source === 'food_cost'
                                    ? lang === 'th'
                                      ? 'ต้นทุนจริง'
                                      : 'Food Cost'
                                    : lang === 'th'
                                    ? 'สูตรเมนู'
                                    : 'Recipe'}
                                </span>
                              </span>
                              {metrics.matchedVariantName && (
                                <span className="truncate max-w-[70px] font-medium text-neutral-500">
                                  {metrics.matchedVariantName}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-1 text-center">
                              <div className="py-0.5 px-1 bg-white rounded border border-neutral-200/80">
                                <div className="text-[8.5px] font-bold text-neutral-500 leading-tight">
                                  {lang === 'th' ? 'ต้นทุน' : 'Cost'}
                                </div>
                                <div className="text-[10px] font-black text-neutral-900 leading-tight">
                                  ฿{formatMoney(metrics.cost)}
                                </div>
                              </div>

                              <div className="py-0.5 px-1 bg-white rounded border border-neutral-200/80">
                                <div className="text-[8.5px] font-bold text-neutral-500 leading-tight">
                                  {lang === 'th' ? 'ที่ร้าน' : 'Dine-In'}
                                </div>
                                <div
                                  className={`text-[10px] font-black leading-tight ${
                                    metrics.dineInProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                  }`}
                                >
                                  {metrics.dineInProfit > 0 ? '+' : ''}฿{formatMoney(metrics.dineInProfit)}
                                </div>
                              </div>

                              <div className="py-0.5 px-1 bg-white rounded border border-neutral-200/80">
                                <div className="text-[8.5px] font-bold text-neutral-500 leading-tight">
                                  {lang === 'th' ? 'ใส่กล่อง' : 'Box'}
                                </div>
                                <div
                                  className={`text-[10px] font-black leading-tight ${
                                    metrics.takeawayProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                  }`}
                                >
                                  {metrics.takeawayProfit > 0 ? '+' : ''}฿{formatMoney(metrics.takeawayProfit)}
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Compact Actions */}
                    <div className="flex items-center justify-between gap-1 mt-1.5 pt-1 border-t border-neutral-100">
                      <span className="text-[9px] text-neutral-400 font-medium truncate">
                        {lang === 'th' ? 'ดับเบิลคลิกแก้ไข' : '2x click edit'}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDish(dish);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="p-1 text-neutral-600 hover:text-orange-600 rounded hover:bg-neutral-100 cursor-pointer"
                          title={t.common.edit}
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete({
                              type: 'dish',
                              id: dish.id,
                              label: dish.nameTh || dish.name,
                            });
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="p-1 text-neutral-400 hover:text-rose-600 rounded hover:bg-rose-50 cursor-pointer"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: CATEGORIES */}
      {/* ========================================================= */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-neutral-600">
              Showing {categories.length} menu categories
            </span>
            <button
              onClick={() => {
                translationScheduler.cancel('cat');
                manualEnKeysRef.current.delete('cat');
                prevCatThaiRef.current = '';
                setEditingCategory({ name: '', nameTh: '', order: categories.length + 1 });
                setIsCategoryModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.menuCost.addCategory}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {categories.map((cat, idx) => (
              <div
                key={cat.id}
                className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs flex items-center justify-between"
              >
                <div>
                  <span className="text-[10px] font-bold text-neutral-400 uppercase">#{idx + 1}</span>
                  <h4 className="font-black text-sm text-neutral-900">
                    {lang === 'th' && cat.nameTh ? cat.nameTh : cat.name}
                  </h4>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      translationScheduler.cancel('cat');
                      manualEnKeysRef.current.delete('cat');
                      if (cat.nameEnManual && (cat.name || '').trim()) {
                        manualEnKeysRef.current.add('cat');
                      }
                      prevCatThaiRef.current = cat.nameTh || '';
                      setEditingCategory(cat);
                      setIsCategoryModalOpen(true);
                    }}
                    className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({
                        type: 'category',
                        id: cat.id,
                        label: lang === 'th' && cat.nameTh ? cat.nameTh : cat.name,
                      })
                    }
                    className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: CHANNELS */}
      {/* ========================================================= */}
      {activeTab === 'channels' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-neutral-600">
              Showing {channels.length} sales channels
            </span>
            <button
              onClick={() => {
                translationScheduler.cancel('ch');
                manualEnKeysRef.current.delete('ch');
                prevChThaiRef.current = '';
                setEditingChannel({ name: '', nameTh: '', type: 'delivery', commissionPercent: 30, packagingCost: 10 });
                setIsChannelModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.menuCost.addChannel}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <h4 className="font-black text-sm text-neutral-900">
                      {lang === 'th' && ch.nameTh ? ch.nameTh : ch.name}
                    </h4>
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700">
                      {ch.type}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1 text-xs text-neutral-600">
                    <div className="flex justify-between">
                      <span>{t.menuCost.commissionPercent}:</span>
                      <span className="font-bold text-neutral-900">{ch.commissionPercent}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t.menuCost.defaultPackagingCost}:</span>
                      <span className="font-bold text-neutral-900">฿{formatMoney(ch.packagingCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t.menuCost.priceMarkupPercent}:</span>
                      <span className="font-bold text-orange-600">
                        {(ch.priceMarkupPercent || 0) > 0 ? `+${ch.priceMarkupPercent}%` : '0%'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-neutral-100">
                  <button
                    onClick={() => {
                      translationScheduler.cancel('ch');
                      manualEnKeysRef.current.delete('ch');
                      if (ch.nameEnManual && (ch.name || '').trim()) {
                        manualEnKeysRef.current.add('ch');
                      }
                      prevChThaiRef.current = ch.nameTh || '';
                      setEditingChannel(ch);
                      setIsChannelModalOpen(true);
                    }}
                    className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({
                        type: 'channel',
                        id: ch.id,
                        label: lang === 'th' && ch.nameTh ? ch.nameTh : ch.name,
                      })
                    }
                    className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>
      </div>

      {/* Bottom Food Category Bar (Visible on Dishes Tab) */}
      {activeTab === 'dishes' && (
        <div className="shrink-0 min-h-[60px] pb-[env(safe-area-inset-bottom)] bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 flex items-center gap-2 overflow-x-auto shadow-[0_-6px_20px_-10px_rgba(15,23,42,0.1)] z-30">
          <button
            type="button"
            onClick={() => setSelectedCategoryId(null)}
            className={`h-10 px-3 rounded-xl flex items-center gap-1.5 font-black text-xs cursor-pointer transition-all shrink-0 active:translate-y-[1px] ${
              selectedCategoryId === null
                ? 'bg-slate-900 text-white shadow-[0_2px_0_#0f172a,0_6px_12px_-5px_rgba(15,23,42,0.35)] ring-2 ring-orange-500'
                : 'bg-white text-slate-800 hover:bg-slate-50 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
            }`}
          >
            <UtensilsCrossed className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="leading-none whitespace-nowrap">
              {lang === 'th' ? 'ทุกหมวดหมู่' : 'All'} ({dishes.length})
            </span>
          </button>

          <div className="h-7 w-px bg-slate-200 shrink-0" />

          {categories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            const dishCount = dishes.filter((d) => d.categoryId === cat.id).length;

            return (
              <div
                key={cat.id}
                className={`h-10 rounded-xl flex items-center shrink-0 transition-all border ${
                  isSelected
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white border-orange-600 shadow-[0_3px_0_#c2410c,0_8px_16px_-6px_rgba(234,88,12,0.32)]'
                    : 'bg-white text-slate-800 hover:bg-orange-50/70 border-slate-200 shadow-[0_2px_0_#e2e8f0]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className="h-full pl-3 pr-2 flex items-center gap-2 font-bold text-xs cursor-pointer active:translate-y-[1px]"
                >
                  <Utensils
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isSelected ? 'text-amber-200' : 'text-orange-500'
                    }`}
                  />
                  <div className="text-left">
                    <div className="leading-tight font-extrabold whitespace-nowrap">
                      {lang === 'th' && cat.nameTh ? cat.nameTh : cat.name}
                    </div>
                    <div
                      className={`text-[9.5px] font-semibold leading-none mt-0.5 ${
                        isSelected ? 'text-orange-100' : 'text-slate-500'
                      }`}
                    >
                      {dishCount} {lang === 'th' ? 'เมนู' : 'dishes'}
                    </div>
                  </div>
                </button>
                <div
                  className={`flex items-center pr-1 border-l ${
                    isSelected ? 'border-white/25' : 'border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      translationScheduler.cancel('cat');
                      manualEnKeysRef.current.delete('cat');
                      if (cat.nameEnManual && (cat.name || '').trim()) {
                        manualEnKeysRef.current.add('cat');
                      }
                      prevCatThaiRef.current = cat.nameTh || '';
                      setEditingCategory(cat);
                      setIsCategoryModalOpen(true);
                    }}
                    title={lang === 'th' ? 'แก้ไขหมวดหมู่' : 'Edit Category'}
                    className={`p-1 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'text-white/90 hover:text-white hover:bg-black/15'
                        : 'text-slate-400 hover:text-orange-600 hover:bg-orange-50'
                    }`}
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete({
                        type: 'category',
                        id: cat.id,
                        label: lang === 'th' && cat.nameTh ? cat.nameTh : cat.name,
                      });
                    }}
                    title={lang === 'th' ? 'ลบหมวดหมู่' : 'Delete Category'}
                    className={`p-1 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'text-white/90 hover:text-white hover:bg-black/15'
                        : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                    }`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => {
              translationScheduler.cancel('cat');
              manualEnKeysRef.current.delete('cat');
              prevCatThaiRef.current = '';
              setEditingCategory({ name: '', nameTh: '', order: categories.length + 1 });
              setIsCategoryModalOpen(true);
            }}
            className="h-10 px-3 rounded-xl flex items-center gap-1.5 font-bold text-xs cursor-pointer transition-all shrink-0 bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-300 shadow-[0_2px_0_#fed7aa] active:translate-y-[1px]"
          >
            <Plus className="w-3.5 h-3.5 text-orange-600 shrink-0" />
            <span className="whitespace-nowrap">
              {lang === 'th' ? '+ เพิ่มหมวดหมู่' : '+ Add Category'}
            </span>
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* DISH MODAL (POS FRONT-OF-HOUSE MENU EDITOR) */}
      {/* ========================================================= */}
      {isDishModalOpen && editingDish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            ref={dishFormRef}
            onSubmit={handleSaveDish}
            className="modal-panel-fixed bg-white rounded-3xl shadow-2xl max-w-3xl w-full border border-orange-200"
          >
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {editingDish.id ? t.menuCost.editDish : t.menuCost.addDish}
              </h3>
              <button
                type="button"
                onClick={closeDishModalCleanly}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              {/* Dish Name Thai-first + Auto-EN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {lang === 'th' ? 'ชื่อเมนู (ภาษาไทย) *' : 'Menu Name (Thai) *'}
                  </label>
                  <input
                    type="text"
                    required={!editingDish.name}
                    value={editingDish.nameTh || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditingDish({ ...editingDish, nameTh: nextTh });
                      translationScheduler.schedule('dish', () => {
                        setEditingDish((prev) => {
                          if (!prev) return prev;
                          const prevTh = prevDishThaiRef.current;
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevTh,
                            nextThai: nextTh,
                            currentEnglish: prev.name || '',
                            isManuallyEdited: manualEnKeysRef.current.has('dish'),
                          });
                          prevDishThaiRef.current = nextTh;
                          return { ...prev, name: nextEn };
                        });
                      });
                    }}
                    onBlur={() => translationScheduler.flush('dish')}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                    placeholder={
                      lang === 'th'
                        ? 'เช่น กะเพรา, ผัดกะเพรา, ข้าวผัด'
                        : 'e.g. กะเพรา, ผัดกะเพรา, ข้าวผัด'
                    }
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <label className="block text-xs font-bold text-neutral-700">
                        {t.menuCost.dishName} (EN)
                      </label>
                      {!translationScheduler.hasPending('dish') &&
                        needsEnglishReview(editingDish.nameTh, editingDish.name) && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                          </span>
                        )}
                    </div>
                    {editingDish.nameTh && (
                      <button
                        type="button"
                        onClick={() => {
                          translationScheduler.cancel('dish');
                          manualEnKeysRef.current.delete('dish');
                          prevDishThaiRef.current = editingDish.nameTh || '';
                          setEditingDish({
                            ...editingDish,
                            name: translateThaiToEnglish(editingDish.nameTh || ''),
                            nameEnManual: false,
                          });
                        }}
                        className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer shrink-0"
                      >
                        {lang === 'th' ? 'แปลใหม่' : 'Re-translate'}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={editingDish.name || ''}
                    onChange={(e) => {
                      translationScheduler.cancel('dish');
                      const val = e.target.value;
                      if (val.trim()) manualEnKeysRef.current.add('dish');
                      else manualEnKeysRef.current.delete('dish');
                      setEditingDish({
                        ...editingDish,
                        name: val,
                        nameEnManual: Boolean(val.trim()),
                      });
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                    placeholder="e.g. Stir-Fried Holy Basil"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-bold text-neutral-700">
                      {t.menuCost.dishCategory}
                    </label>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const currentCat = categories.find(
                          (c) => c.id === (editingDish.categoryId || categories[0]?.id)
                        );
                        if (!currentCat) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              translationScheduler.cancel('cat');
                              manualEnKeysRef.current.delete('cat');
                              if (currentCat.nameEnManual && (currentCat.name || '').trim()) {
                                manualEnKeysRef.current.add('cat');
                              }
                              prevCatThaiRef.current = currentCat.nameTh || '';
                              setEditingCategory(currentCat);
                              setIsCategoryModalOpen(true);
                            }}
                            className="text-[11px] font-bold text-neutral-600 hover:text-orange-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>{lang === 'th' ? 'แก้ไข' : 'Edit'}</span>
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => {
                          translationScheduler.cancel('cat');
                          manualEnKeysRef.current.delete('cat');
                          prevCatThaiRef.current = '';
                          setEditingCategory({ name: '', nameTh: '', order: categories.length + 1 });
                          setIsCategoryModalOpen(true);
                        }}
                        className="text-[11px] font-bold text-orange-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{lang === 'th' ? '+ เพิ่มหมวดหมู่' : '+ Add Category'}</span>
                      </button>
                    </div>
                  </div>
                  <select
                    value={editingDish.categoryId || categories[0]?.id || ''}
                    onChange={(e) => setEditingDish({ ...editingDish, categoryId: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {lang === 'th' && c.nameTh ? c.nameTh : c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Photo Upload with Live Visual Preview */}
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.dishImage}
                  </label>
                  <div className="p-2.5 bg-neutral-50 border border-neutral-200 rounded-2xl flex items-center gap-3">
                    {/* Visible Preview Frame */}
                    <div className="w-20 h-20 rounded-xl bg-white border border-neutral-200 shadow-xs overflow-hidden shrink-0 flex items-center justify-center">
                      {editingDishPreviewUrl || (editingDish.id ? dishImages.get(editingDish.id) : null) ? (
                        <img
                          src={
                            editingDishPreviewUrl ||
                            (editingDish.id ? dishImages.get(editingDish.id) : '') ||
                            ''
                          }
                          alt={editingDish.nameTh || editingDish.name || 'Dish preview'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-neutral-300 gap-1">
                          <Utensils className="w-6 h-6" />
                          <span className="text-[9px] font-bold text-neutral-400">
                            {lang === 'th' ? 'ไม่มีรูป' : 'No Photo'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Upload Controls + Status */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label className="px-3 py-1.5 bg-white hover:bg-orange-50 text-neutral-800 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer flex items-center gap-1.5 shadow-2xs">
                          <Upload className="w-3.5 h-3.5 text-orange-600" />
                          <span>
                            {isUploadingImage
                              ? lang === 'th'
                                ? 'กำลังบีบอัดรูป...'
                                : 'Compressing...'
                              : editingDish.imageId || editingDishPreviewUrl
                              ? lang === 'th'
                                ? 'เปลี่ยนรูปภาพ'
                                : 'Change Photo'
                              : t.menuCost.uploadPhoto}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoUpload}
                            className="hidden"
                          />
                        </label>

                        {(editingDish.imageId || editingDishPreviewUrl) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDish({ ...editingDish, imageId: undefined });
                              setEditingDishPreviewUrl(null);
                              setEditingDishImageSizeKb(null);
                              setImageUploadError(null);
                            }}
                            className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>{t.menuCost.removePhoto}</span>
                          </button>
                        )}
                      </div>

                      {imageUploadError ? (
                        <p className="text-[11px] font-bold text-rose-600">{imageUploadError}</p>
                      ) : editingDish.imageId || editingDishPreviewUrl ? (
                        <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {lang === 'th' ? 'โหลดรูปภาพพร้อมแสดงผลแล้ว' : 'Photo ready'}
                            {editingDishImageSizeKb ? ` (${editingDishImageSizeKb} KB)` : ''}
                          </span>
                        </p>
                      ) : (
                        <p className="text-[11px] text-neutral-400">
                          {lang === 'th'
                            ? 'รองรับ JPG/PNG ระบบย่อขนาดให้อัตโนมัติ'
                            : 'Auto-compressed under 150KB'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Primary Options Section ("ตัวเลือกหลักของเมนู") — Auto-Pulled Real-Time From Food Cost */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-neutral-800">{t.menuCost.variants}</span>
                    {matchedEditingCostMenu && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span>
                          {lang === 'th'
                            ? `ดึงข้อมูลจริงจากต้นทุนอาหาร: ${getLocalizedText(lang, matchedEditingCostMenu.name, matchedEditingCostMenu.englishName)} (${getActiveCostVariants(matchedEditingCostMenu).length} รายการ)`
                            : `Synced with Food Cost: ${getLocalizedText(lang, matchedEditingCostMenu.name, matchedEditingCostMenu.englishName)} (${getActiveCostVariants(matchedEditingCostMenu).length} items)`}
                        </span>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCostMenuId(null);
                      setPickerSourceTab('menus');
                      setPrimaryOptionSearch('');
                      loadCostingCatalog();
                      setIsPrimaryOptionPickerOpen(true);
                    }}
                    className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 border border-orange-300 text-orange-700 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>
                      {matchedEditingCostMenu
                        ? lang === 'th'
                          ? 'เปลี่ยนเมนูต้นทุน'
                          : 'Change Cost Menu'
                        : lang === 'th'
                        ? '+ เชื่อมข้อมูลจากต้นทุนอาหาร'
                        : '+ Link Food Cost Menu'}
                    </span>
                  </button>
                </div>

                {matchedEditingCostMenu ? (
                  (() => {
                    const costVars = getActiveCostVariants(matchedEditingCostMenu);
                    return (
                      <div className="space-y-2">
                        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
                          <table className="w-full min-w-[560px] text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-neutral-100 border-b border-neutral-200 text-[10.5px] font-extrabold text-neutral-700">
                                <th className="py-2 px-2.5">{lang === 'th' ? 'ชื่อรายการ' : 'Item'}</th>
                                <th className="py-2 px-2 text-right w-28">
                                  {lang === 'th' ? 'ราคาตั้งขาย (฿)' : 'Selling Price (฿)'}
                                </th>
                                <th className="py-2 px-2 text-right">{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</th>
                                <th className="py-2 px-2 text-right">{lang === 'th' ? '%ต้นทุน' : '% Cost'}</th>
                                <th className="py-2 px-2 text-right">{lang === 'th' ? 'กำไรกินที่ร้าน' : 'Dine-in Profit'}</th>
                                <th className="py-2 px-2.5 text-right">{lang === 'th' ? 'กำไรใส่กล่อง' : 'Takeaway Profit'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                              {costVars.map((cv) => {
                                const labelTh = getCostVariantLabel(cv);
                                const displayLabel = getLocalizedText(lang, labelTh, cv.englishName);
                                const existingMatched = findExistingPosVariantForCostVariant(
                                  cv,
                                  editingDish.variants || []
                                );
                                const currentSellingPrice = resolveCostVariantSellingPrice(
                                  matchedEditingCostMenu,
                                  cv,
                                  existingMatched,
                                  modalPriceOverrides[cv.id]
                                );
                                const bd = computeCostVariantRealtimeBreakdown(
                                  matchedEditingCostMenu,
                                  cv,
                                  currentSellingPrice
                                );
                                const fcPct = bd.fcPercent || 0;

                                return (
                                  <tr
                                    key={cv.id}
                                    className="hover:bg-orange-50/40 transition-colors"
                                  >
                                    <td className="py-2 px-2.5">
                                      <div className="font-black text-neutral-900 text-xs leading-tight">
                                        {displayLabel}
                                      </div>
                                      {cv.name && cv.name !== labelTh && lang === 'th' && (
                                        <div className="text-[10px] text-neutral-400 truncate max-w-[160px]">
                                          {cv.name}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 text-right">
                                      <NumericInput
                                        min={0}
                                        step={1}
                                        value={currentSellingPrice}
                                        onValueChange={(val) =>
                                          handleUpdateCostVariantPrice(
                                            matchedEditingCostMenu,
                                            cv,
                                            val
                                          )
                                        }
                                        className="w-24 px-2 py-1 text-right text-xs font-black bg-orange-50/70 border border-orange-300 rounded-lg text-orange-700 focus:ring-2 focus:ring-orange-500 focus:bg-white"
                                      />
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono font-bold text-neutral-800">
                                      ฿{formatMoney(bd.totalCost)}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono font-black">
                                      <span
                                        className={`px-1.5 py-0.5 rounded-md text-[11px] ${
                                          fcPct > 45
                                            ? 'bg-rose-50 text-rose-700'
                                            : fcPct > 35
                                            ? 'bg-amber-50 text-amber-700'
                                            : 'bg-emerald-50 text-emerald-700'
                                        }`}
                                      >
                                        {fcPct}%
                                      </span>
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono font-black">
                                      <span
                                        className={
                                          bd.dineInProfit >= 0
                                            ? 'text-emerald-700'
                                            : 'text-rose-600'
                                        }
                                      >
                                        {bd.dineInProfit > 0 ? '+' : ''}฿
                                        {formatMoney(bd.dineInProfit)}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono font-black">
                                      <span
                                        className={
                                          bd.takeawayProfit >= 0
                                            ? 'text-emerald-700'
                                            : 'text-rose-600'
                                        }
                                      >
                                        {bd.takeawayProfit > 0 ? '+' : ''}฿
                                        {formatMoney(bd.takeawayProfit)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10.5px] text-neutral-500">
                          {lang === 'th'
                            ? 'ยึดตามตัวเลือกที่สร้างไว้ใน "ต้นทุนอาหาร" • แก้ไขราคาตั้งขายเพื่อคำนวณ %ต้นทุน และกำไรแบบเรียลไทม์ทันที'
                            : 'Synced with variants configured in Food Cost • Edit selling price to recalculate % cost and profit in real time.'}
                        </p>
                      </div>
                    );
                  })()
                ) : (
                  <>
                    {/* Manual Primary Option Tabs (For standalone POS dishes without Food Cost menu match) */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {editingDish.variants?.map((v, idx) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setActiveDishVariantIndex(idx)}
                            className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                              activeDishVariantIndex === idx
                                ? 'bg-orange-500 text-white'
                                : 'bg-white border border-neutral-300 text-neutral-700'
                            }`}
                          >
                            <span>{lang === 'th' ? v.nameTh || v.name : v.name || v.nameTh}</span>
                            <span className="opacity-90">(฿{formatMoney(v.price)})</span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newVar: DishVariant = {
                            id: `var_${Date.now()}`,
                            nameTh: '',
                            name: '',
                            price: editingDish.variants?.[0]?.price || 100,
                            ingredients: [],
                            subRecipes: [],
                            packaging: [],
                          };
                          const nextVars = [...(editingDish.variants || []), newVar];
                          setEditingDish({ ...editingDish, variants: nextVars });
                          setActiveDishVariantIndex(nextVars.length - 1);
                        }}
                        className="px-2 py-1 bg-white hover:bg-orange-50 border border-neutral-300 text-neutral-700 rounded-lg text-[11px] font-bold cursor-pointer shrink-0"
                      >
                        {lang === 'th' ? '+ เพิ่มตัวเลือกเอง' : '+ Add Option'}
                      </button>
                    </div>

                    {/* Compact Active Primary Option Editor */}
                    {editingDish.variants?.[activeDishVariantIndex] && (() => {
                      const currVar = editingDish.variants[activeDishVariantIndex];
                      const varMetrics = getLinkedFoodCostMetrics(editingDish, currVar);

                      return (
                        <div className="space-y-2.5 pt-2 border-t border-neutral-200">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                                {lang === 'th' ? 'ชื่อตัวเลือกหลัก (ภาษาไทย) *' : 'Option Name (Thai) *'}
                              </label>
                              <input
                                type="text"
                                required={!currVar.name}
                                value={currVar.nameTh || ''}
                                onChange={(e) => {
                                  const nextTh = e.target.value;
                                  const varId = currVar.id;
                                  const varKey = `var_${varId}`;
                                  const updated = [...(editingDish.variants || [])];
                                  updated[activeDishVariantIndex] = {
                                    ...updated[activeDishVariantIndex],
                                    nameTh: nextTh,
                                  };
                                  setEditingDish({ ...editingDish, variants: updated });
                                  translationScheduler.schedule(varKey, () => {
                                    setEditingDish((prev) => {
                                      if (!prev?.variants) return prev;
                                      const prevTh = prevVarThaiMapRef.current.get(varId) || '';
                                      const nextVars = prev.variants.map((v) => {
                                        if (v.id !== varId) return v;
                                        const nextEn = computeAutoEnglishName({
                                          previousThai: prevTh,
                                          nextThai: nextTh,
                                          currentEnglish: v.name || '',
                                          isManuallyEdited: manualEnKeysRef.current.has(varKey),
                                        });
                                        return { ...v, name: nextEn };
                                      });
                                      prevVarThaiMapRef.current.set(varId, nextTh);
                                      return { ...prev, variants: nextVars };
                                    });
                                  });
                                }}
                                onBlur={() => translationScheduler.flush(`var_${currVar.id}`)}
                                className="w-full px-2.5 py-1 text-xs bg-white border border-orange-300 rounded-lg"
                                placeholder={lang === 'th' ? 'เช่น ธรรมดา, พิเศษ' : 'e.g. ธรรมดา, พิเศษ'}
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between gap-1.5 mb-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <label className="block text-[11px] font-bold text-neutral-600">
                                    {lang === 'th' ? 'ชื่อ EN' : 'Name (EN)'}
                                  </label>
                                  {!translationScheduler.hasPending(`var_${currVar.id}`) &&
                                    needsEnglishReview(currVar.nameTh, currVar.name) && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700">
                                        <AlertTriangle className="w-3 h-3 shrink-0" />
                                        <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                                      </span>
                                    )}
                                </div>
                                {currVar.nameTh && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const varKey = `var_${currVar.id}`;
                                      translationScheduler.cancel(varKey);
                                      manualEnKeysRef.current.delete(varKey);
                                      prevVarThaiMapRef.current.set(currVar.id, currVar.nameTh || '');
                                      const updated = [...(editingDish.variants || [])];
                                      updated[activeDishVariantIndex] = {
                                        ...updated[activeDishVariantIndex],
                                        name: translateThaiToEnglish(currVar.nameTh || ''),
                                        nameEnManual: false,
                                      };
                                      setEditingDish({ ...editingDish, variants: updated });
                                    }}
                                    className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer shrink-0"
                                  >
                                    {lang === 'th' ? 'แปลใหม่' : 'Re-translate'}
                                  </button>
                                )}
                              </div>
                              <input
                                type="text"
                                value={currVar.name || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const key = `var_${currVar.id}`;
                                  translationScheduler.cancel(key);
                                  if (val.trim()) manualEnKeysRef.current.add(key);
                                  else manualEnKeysRef.current.delete(key);
                                  const updated = [...(editingDish.variants || [])];
                                  updated[activeDishVariantIndex] = {
                                    ...updated[activeDishVariantIndex],
                                    name: val,
                                    nameEnManual: Boolean(val.trim()),
                                  };
                                  setEditingDish({ ...editingDish, variants: updated });
                                }}
                                className="w-full px-2.5 py-1 text-xs bg-neutral-100/70 border border-neutral-300 rounded-lg"
                                placeholder="e.g. Standard"
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="block text-[11px] font-bold text-neutral-600">
                                  {lang === 'th' ? 'ราคาตั้งขาย (บาท)' : 'Selling Price (THB)'}
                                </label>
                                {(editingDish.variants?.length || 0) > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = (editingDish.variants || []).filter(
                                        (_, i) => i !== activeDishVariantIndex
                                      );
                                      setEditingDish({ ...editingDish, variants: updated });
                                      setActiveDishVariantIndex(Math.max(0, activeDishVariantIndex - 1));
                                    }}
                                    className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer flex items-center gap-0.5"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>{lang === 'th' ? 'ลบตัวเลือกนี้' : 'Remove Option'}</span>
                                  </button>
                                )}
                              </div>
                              <NumericInput
                                min={0}
                                step={1}
                                value={currVar.price}
                                onValueChange={(val) => {
                                  const updated = [...(editingDish.variants || [])];
                                  updated[activeDishVariantIndex] = {
                                    ...updated[activeDishVariantIndex],
                                    price: val,
                                  };
                                  setEditingDish({ ...editingDish, variants: updated });
                                }}
                                className="w-full px-2.5 py-1 text-xs bg-white border border-neutral-300 rounded-lg font-bold"
                              />
                            </div>
                          </div>

                          <div
                            className={`px-3 py-2 rounded-xl border text-[11px] space-y-1.5 ${
                              varMetrics.hasData
                                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                                : 'bg-white border-neutral-200 text-neutral-600'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-bold flex items-center gap-1.5">
                                {varMetrics.hasData ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                    <span>
                                      {varMetrics.source === 'food_cost'
                                        ? lang === 'th'
                                          ? `เชื่อมข้อมูลจริงจากต้นทุนอาหาร (${varMetrics.matchedMenuName} • ${varMetrics.matchedVariantName})`
                                          : `Linked to Food Cost (${getLocalizedText(lang, varMetrics.matchedMenuName)} • ${getLocalizedText(lang, varMetrics.matchedVariantName)})`
                                        : lang === 'th'
                                        ? 'เชื่อมข้อมูลต้นทุนจากสูตรเมนู'
                                        : 'Linked to Menu Recipe Cost'}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-neutral-500">
                                    {lang === 'th'
                                      ? 'ยังไม่พบชื่อเมนูตรงกันในส่วนต้นทุนอาหาร (กด "เชื่อมข้อมูลจากต้นทุนอาหาร" เพื่อเลือกเมนู)'
                                      : 'No matching Food Cost item found yet (click "Link Food Cost Menu" to select)'}
                                  </span>
                                )}
                              </span>
                            </div>

                            {varMetrics.hasData && (
                              <div className="grid grid-cols-4 gap-2 pt-1.5 border-t border-emerald-200/70 text-center">
                                <div>
                                  <span className="text-[10px] text-neutral-600 block">
                                    {lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}
                                  </span>
                                  <span className="font-black text-neutral-900">
                                    ฿{formatMoney(varMetrics.cost)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-neutral-600 block">
                                    {lang === 'th' ? '%ต้นทุน' : '% Cost'}
                                  </span>
                                  <span className="font-black text-neutral-900">
                                    {varMetrics.foodCostPercent.toFixed(1)}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-neutral-600 block">
                                    {lang === 'th' ? 'กำไรกินที่ร้าน' : 'Dine-in Profit'}
                                  </span>
                                  <span
                                    className={`font-black ${
                                      varMetrics.dineInProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                    }`}
                                  >
                                    {varMetrics.dineInProfit > 0 ? '+' : ''}฿
                                    {formatMoney(varMetrics.dineInProfit)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-neutral-600 block">
                                    {lang === 'th' ? 'กำไรใส่กล่อง' : 'Takeaway Profit'}
                                  </span>
                                  <span
                                    className={`font-black ${
                                      varMetrics.takeawayProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                    }`}
                                  >
                                    {varMetrics.takeawayProfit > 0 ? '+' : ''}฿
                                    {formatMoney(varMetrics.takeawayProfit)}
                                  </span>
                                </div>
                              </div>
                            )}

                            {(() => {
                              const isAddMode = !editingDish.id;
                              const canOpenCentralRecipe =
                                varMetrics.source === 'food_cost' &&
                                Boolean(varMetrics.matchedVariantId || varMetrics.matchedMenuId);
                              const buttonLabel = isAddMode
                                ? lang === 'en'
                                  ? CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenEn
                                  : CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenTh
                                : lang === 'en'
                                ? CENTRAL_RECIPE_BUTTON_LABELS.openEn
                                : CENTRAL_RECIPE_BUTTON_LABELS.openTh;
                              return (
                                <div className="pt-1.5 border-t border-emerald-200/70 flex flex-wrap items-center justify-between gap-2">
                                  {!canOpenCentralRecipe && (
                                    <span className="text-[10.5px] font-semibold text-amber-800">
                                      {lang === 'en'
                                        ? CENTRAL_RECIPE_BUTTON_LABELS.unresolvedHintEn
                                        : CENTRAL_RECIPE_BUTTON_LABELS.unresolvedHintTh}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={
                                      !canOpenCentralRecipe ||
                                      !onOpenCentralRecipe ||
                                      isNavigatingToRecipe
                                    }
                                    onClick={async () => {
                                      if (
                                        isNavigatingToRecipe ||
                                        !canOpenCentralRecipe ||
                                        !onOpenCentralRecipe
                                      ) {
                                        return;
                                      }
                                      const target = {
                                        variantId: varMetrics.matchedVariantId || undefined,
                                        menuId: varMetrics.matchedMenuId || undefined,
                                      };
                                      if (isAddMode) {
                                        setIsNavigatingToRecipe(true);
                                        const res = await saveDishFromModal();
                                        if (res.ok) {
                                          onOpenCentralRecipe(target);
                                        }
                                        setIsNavigatingToRecipe(false);
                                        return;
                                      }
                                      if (isDishModalDirty) {
                                        setPendingRecipeNavTarget(target);
                                        return;
                                      }
                                      setIsNavigatingToRecipe(true);
                                      closeDishModalCleanly();
                                      onOpenCentralRecipe(target);
                                    }}
                                    title={buttonLabel}
                                    aria-label={buttonLabel}
                                    className="min-h-[36px] px-3 py-1.5 rounded-xl border border-emerald-400/90 bg-white/90 hover:bg-emerald-100/80 text-emerald-900 font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-auto w-full sm:w-auto"
                                  >
                                    <BookOpen className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                    <span>{buttonLabel}</span>
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>

              {/* Selected Sub-Option Groups Only + Picker Button */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-neutral-800">
                    {t.menuCost.attachedOptionGroups}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setOptionGroupSearch('');
                      setIsOptionGroupPickerOpen(true);
                    }}
                    className="px-2.5 py-1 bg-white hover:bg-orange-50 border border-orange-300 text-orange-700 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{lang === 'th' ? 'เพิ่มตัวเลือกย่อย' : 'Add Sub-Options'}</span>
                  </button>
                </div>

                {(() => {
                  const selectedGroups = optionGroups.filter((grp) =>
                    (editingDish.optionGroupIds || []).includes(grp.id)
                  );
                  if (selectedGroups.length === 0) {
                    return (
                      <div className="p-2.5 bg-white rounded-xl border border-dashed border-neutral-300 text-[11px] text-neutral-500 text-center">
                        {lang === 'th'
                          ? 'ยังไม่ได้เลือกตัวเลือกย่อย กดปุ่ม "+ เพิ่มตัวเลือกย่อย" เพื่อเลือกจากกลุ่มที่สร้างไว้'
                          : 'No sub-options attached yet. Click "+ Add Sub-Options" to choose from existing groups.'}
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {selectedGroups.map((grp) => (
                        <div
                          key={grp.id}
                          className="p-2.5 bg-white rounded-xl border border-orange-200 flex items-start justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-neutral-900 truncate">
                              {lang === 'th' ? grp.nameTh || grp.name : grp.name || grp.nameTh}
                              {grp.nameTh && grp.name && grp.name !== grp.nameTh && lang === 'th' && (
                                <span className="ml-1 text-[10px] font-medium text-neutral-400">
                                  ({grp.name})
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-500 truncate mt-0.5">
                              {grp.choices
                                .map((c) => (lang === 'th' ? c.nameTh || c.name : c.name || c.nameTh))
                                .join(', ')}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDish({
                                ...editingDish,
                                optionGroupIds: (editingDish.optionGroupIds || []).filter(
                                  (id) => id !== grp.id
                                ),
                              });
                            }}
                            className="p-1 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer shrink-0"
                            title={lang === 'th' ? 'นำออก' : 'Remove'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {dishModalError && (
              <div className="shrink-0 px-4 sm:px-6 py-2 bg-rose-50 border-t border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{dishModalError}</span>
              </div>
            )}

            {pendingRecipeNavTarget && (
              <div className="shrink-0 px-4 sm:px-6 py-3 bg-amber-50 border-t border-amber-200 text-xs space-y-2">
                <div className="font-bold text-amber-950 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    {lang === 'en'
                      ? 'You have unsaved changes in this menu. What would you like to do?'
                      : 'คุณมีการแก้ไขเมนูนี้ที่ยังไม่ได้บันทึก ต้องการดำเนินการอย่างไร?'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isNavigatingToRecipe}
                    onClick={async () => {
                      if (isNavigatingToRecipe || !onOpenCentralRecipe) return;
                      const target = pendingRecipeNavTarget;
                      setIsNavigatingToRecipe(true);
                      const res = await saveDishFromModal();
                      if (res.ok) {
                        onOpenCentralRecipe(target);
                      } else {
                        setPendingRecipeNavTarget(null);
                      }
                      setIsNavigatingToRecipe(false);
                    }}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    {lang === 'en'
                      ? CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenEn
                      : CENTRAL_RECIPE_BUTTON_LABELS.saveAndOpenTh}
                  </button>
                  <button
                    type="button"
                    disabled={isNavigatingToRecipe}
                    onClick={() => {
                      if (isNavigatingToRecipe || !onOpenCentralRecipe) return;
                      const target = pendingRecipeNavTarget;
                      setIsNavigatingToRecipe(true);
                      closeDishModalCleanly();
                      onOpenCentralRecipe(target);
                    }}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 font-bold cursor-pointer disabled:opacity-50"
                  >
                    {lang === 'en'
                      ? CENTRAL_RECIPE_BUTTON_LABELS.goWithoutSavingEn
                      : CENTRAL_RECIPE_BUTTON_LABELS.goWithoutSavingTh}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRecipeNavTarget(null)}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-neutral-200 hover:bg-neutral-300 text-neutral-800 font-bold cursor-pointer"
                  >
                    {lang === 'en'
                      ? CENTRAL_RECIPE_BUTTON_LABELS.stayEn
                      : CENTRAL_RECIPE_BUTTON_LABELS.stayTh}
                  </button>
                </div>
              </div>
            )}

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDishModalCleanly}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CATEGORY MODAL */}
      {isCategoryModalOpen && editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              translationScheduler.cancel('cat');
              const finalTh = (editingCategory.nameTh || '').trim();
              const isCatManual =
                manualEnKeysRef.current.has('cat') && Boolean((editingCategory.name || '').trim());
              const finalEn = isCatManual
                ? (editingCategory.name || '').trim()
                : (
                    computeAutoEnglishName({
                      previousThai: prevCatThaiRef.current,
                      nextThai: finalTh,
                      currentEnglish: editingCategory.name || '',
                      isManuallyEdited: false,
                    }) || (finalTh ? translateThaiToEnglish(finalTh) : '')
                  ).trim();
              if (!finalEn && !finalTh) return;
              const isNew = !editingCategory.id;
              const catToSave: CategoryDoc = {
                id: editingCategory.id || `cat_${Date.now()}`,
                name: finalEn || finalTh,
                nameEnManual: isCatManual,
                ...(finalTh ? { nameTh: finalTh } : {}),
                order: editingCategory.order || categories.length + 1,
                createdAt: editingCategory.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: editingCategory.version || 1,
              };
              await saveDocument('categories', catToSave, isNew);
              if (isDishModalOpen && editingDish && isNew) {
                setEditingDish((prev) => (prev ? { ...prev, categoryId: catToSave.id } : prev));
              }
              setIsCategoryModalOpen(false);
              setEditingCategory(null);
              loadData();
            }}
            className="modal-panel bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200"
          >
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {editingCategory.id
                  ? lang === 'th'
                    ? 'แก้ไขหมวดหมู่'
                    : 'Edit Category'
                  : t.menuCost.addCategory}
              </h3>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {lang === 'th' ? 'ชื่อหมวดหมู่ (ภาษาไทย) *' : 'Category Name (Thai) *'}
                </label>
                <input
                  type="text"
                  required={!editingCategory.name}
                  value={editingCategory.nameTh || ''}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    setEditingCategory({ ...editingCategory, nameTh: nextTh });
                    translationScheduler.schedule('cat', () => {
                      setEditingCategory((prev) => {
                        if (!prev) return prev;
                        const nextEn = computeAutoEnglishName({
                          previousThai: prevCatThaiRef.current,
                          nextThai: nextTh,
                          currentEnglish: prev.name || '',
                          isManuallyEdited: manualEnKeysRef.current.has('cat'),
                        });
                        prevCatThaiRef.current = nextTh;
                        return { ...prev, name: nextEn };
                      });
                    });
                  }}
                  onBlur={() => translationScheduler.flush('cat')}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl"
                  placeholder={lang === 'th' ? 'เช่น อาหารจานหลัก, เครื่องดื่ม' : 'e.g. Main Dishes, Drinks'}
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <label className="block text-xs font-bold text-neutral-700">
                      {t.menuCost.categoryName} (EN)
                    </label>
                    {!translationScheduler.hasPending('cat') &&
                      needsEnglishReview(editingCategory.nameTh, editingCategory.name) && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                        </span>
                      )}
                  </div>
                  {editingCategory.nameTh && (
                    <button
                      type="button"
                      onClick={() => {
                        translationScheduler.cancel('cat');
                        manualEnKeysRef.current.delete('cat');
                        prevCatThaiRef.current = editingCategory.nameTh || '';
                        setEditingCategory({
                          ...editingCategory,
                          name: translateThaiToEnglish(editingCategory.nameTh || ''),
                          nameEnManual: false,
                        });
                      }}
                      className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer shrink-0"
                    >
                      {lang === 'th' ? 'แปลใหม่' : 'Re-translate'}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={editingCategory.name || ''}
                  onChange={(e) => {
                    translationScheduler.cancel('cat');
                    const val = e.target.value;
                    if (val.trim()) manualEnKeysRef.current.add('cat');
                    else manualEnKeysRef.current.delete('cat');
                    setEditingCategory({
                      ...editingCategory,
                      name: val,
                      nameEnManual: Boolean(val.trim()),
                    });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. Main Dishes"
                />
              </div>
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CHANNEL MODAL */}
      {isChannelModalOpen && editingChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              translationScheduler.cancel('ch');
              const finalTh = (editingChannel.nameTh || '').trim();
              const isChManual =
                manualEnKeysRef.current.has('ch') && Boolean((editingChannel.name || '').trim());
              const finalEn = isChManual
                ? (editingChannel.name || '').trim()
                : (
                    computeAutoEnglishName({
                      previousThai: prevChThaiRef.current,
                      nextThai: finalTh,
                      currentEnglish: editingChannel.name || '',
                      isManuallyEdited: false,
                    }) || (finalTh ? translateThaiToEnglish(finalTh) : '')
                  ).trim();
              if (!finalEn && !finalTh) return;
              const isNew = !editingChannel.id;
              const chToSave: ChannelDoc = {
                id: editingChannel.id || `ch_${Date.now()}`,
                name: finalEn || finalTh,
                nameEnManual: isChManual,
                ...(finalTh ? { nameTh: finalTh } : {}),
                type: editingChannel.type || 'delivery',
                commissionPercent: editingChannel.commissionPercent || 0,
                packagingCost: editingChannel.packagingCost || 0,
                priceMarkupPercent: editingChannel.priceMarkupPercent || 0,
                createdAt: editingChannel.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: editingChannel.version || 1,
              };
              await saveDocument('channels', chToSave, isNew);
              setIsChannelModalOpen(false);
              setEditingChannel(null);
              loadData();
            }}
            className="modal-panel bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200"
          >
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.menuCost.addChannel}</h3>
              <button
                type="button"
                onClick={() => setIsChannelModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {lang === 'th' ? 'ชื่อช่องทางขาย (ภาษาไทย) *' : 'Channel Name (Thai) *'}
                </label>
                <input
                  type="text"
                  required={!editingChannel.name}
                  value={editingChannel.nameTh || ''}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    setEditingChannel({ ...editingChannel, nameTh: nextTh });
                    translationScheduler.schedule('ch', () => {
                      setEditingChannel((prev) => {
                        if (!prev) return prev;
                        const nextEn = computeAutoEnglishName({
                          previousThai: prevChThaiRef.current,
                          nextThai: nextTh,
                          currentEnglish: prev.name || '',
                          isManuallyEdited: manualEnKeysRef.current.has('ch'),
                        });
                        prevChThaiRef.current = nextTh;
                        return { ...prev, name: nextEn };
                      });
                    });
                  }}
                  onBlur={() => translationScheduler.flush('ch')}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl"
                  placeholder={lang === 'th' ? 'เช่น หน้าร้าน, กลับบ้าน, GrabFood' : 'e.g. Dine-In, Takeaway, GrabFood'}
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <label className="block text-xs font-bold text-neutral-700">
                      {t.menuCost.channelName} (EN)
                    </label>
                    {!translationScheduler.hasPending('ch') &&
                      needsEnglishReview(editingChannel.nameTh, editingChannel.name) && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                        </span>
                      )}
                  </div>
                  {editingChannel.nameTh && (
                    <button
                      type="button"
                      onClick={() => {
                        translationScheduler.cancel('ch');
                        manualEnKeysRef.current.delete('ch');
                        prevChThaiRef.current = editingChannel.nameTh || '';
                        setEditingChannel({
                          ...editingChannel,
                          name: translateThaiToEnglish(editingChannel.nameTh || ''),
                          nameEnManual: false,
                        });
                      }}
                      className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer shrink-0"
                    >
                      {lang === 'th' ? 'แปลใหม่' : 'Re-translate'}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={editingChannel.name || ''}
                  onChange={(e) => {
                    translationScheduler.cancel('ch');
                    const val = e.target.value;
                    if (val.trim()) manualEnKeysRef.current.add('ch');
                    else manualEnKeysRef.current.delete('ch');
                    setEditingChannel({
                      ...editingChannel,
                      name: val,
                      nameEnManual: Boolean(val.trim()),
                    });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. LINE MAN, GrabFood"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.menuCost.commissionPercent}
                </label>
                <NumericInput
                  min={0}
                  max={100}
                  value={editingChannel.commissionPercent}
                  onValueChange={(val) =>
                    setEditingChannel({ ...editingChannel, commissionPercent: val })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.menuCost.defaultPackagingCost}
                </label>
                <NumericInput
                  min={0}
                  step={0.5}
                  value={editingChannel.packagingCost}
                  onValueChange={(val) =>
                    setEditingChannel({ ...editingChannel, packagingCost: val })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.menuCost.priceMarkupPercent} (%)
                </label>
                <NumericInput
                  min={0}
                  max={200}
                  step={1}
                  value={editingChannel.priceMarkupPercent}
                  onValueChange={(val) =>
                    setEditingChannel({ ...editingChannel, priceMarkupPercent: val })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. 15 for 15% price markup"
                />
              </div>
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsChannelModalOpen(false)}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================= */}
      {/* FOOD COST PRIMARY OPTION PICKER MODAL ("เพิ่มตัวเลือกหลัก") */}
      {/* ========================================================= */}
      {isPrimaryOptionPickerOpen && editingDish && (() => {
        const q = primaryOptionSearch.trim().toLowerCase();
        const dishThLower = (editingDish.nameTh || '').trim().toLowerCase();
        const dishEnLower = (editingDish.name || '').trim().toLowerCase();

        const costIngMapLocal = new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i]));

        // Sort costing menus so matching dish name comes first
        const sortedCostMenus = [...costMenus]
          .filter((m) => m.active !== false && (m.variants || []).length > 0)
          .sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const aMatch =
              (dishThLower && (aName.includes(dishThLower) || dishThLower.includes(aName))) ||
              (dishEnLower && aName.includes(dishEnLower));
            const bMatch =
              (dishThLower && (bName.includes(dishThLower) || dishThLower.includes(bName))) ||
              (dishEnLower && bName.includes(dishEnLower));
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return (a.displayOrder || 99) - (b.displayOrder || 99);
          });

        const selectedCostMenu = selectedCostMenuId
          ? sortedCostMenus.find((m) => m.id === selectedCostMenuId) || null
          : null;

        const filteredMenus = sortedCostMenus.filter((menu) => {
          if (!q) return true;
          return `${menu.name} ${menu.category || ''}`.toLowerCase().includes(q);
        });

        const selectedMenuVariants: Array<{
          variant: CostMenuVariant;
          sellingPrice: number;
          cost: number;
          dineInProfit: number;
          takeawayProfit: number;
        }> = [];

        if (selectedCostMenu) {
          for (const v of selectedCostMenu.variants || []) {
            const hay = `${v.name} ${v.proteinType || ''}`.toLowerCase();
            if (q && !hay.includes(q)) continue;

            const bd = calculateSpreadsheetRowMetrics({
              menu: selectedCostMenu,
              variant: v,
              ingredientsMap: costIngMapLocal,
              servingMode: 'ON_RICE',
            });

            selectedMenuVariants.push({
              variant: v,
              sellingPrice: bd.sellingPrice,
              cost: bd.totalCost || 0,
              dineInProfit: bd.dineInProfit || 0,
              takeawayProfit: bd.takeawayProfit || 0,
            });
          }
        }

        // Protein / Meat ingredients from Costing (separate optional tab)
        const proteinIngredients = costIngredients.filter((ing) => {
          if (ing.active === false) return false;
          const isMeat = ing.category === 'เนื้อสัตว์และอาหารทะเล';
          const matchesSearch = q ? ing.name.toLowerCase().includes(q) : isMeat;
          return matchesSearch;
        });

        const appendImportedVariant = async (newVariant: DishVariant) => {
          const currentVars = editingDish.variants || [];
          const hasOnlyBlankPlaceholder =
            currentVars.length === 1 &&
            !editingDish.id &&
            (currentVars[0].name === 'Standard' || currentVars[0].nameTh === 'มาตรฐาน') &&
            (currentVars[0].ingredients?.length || 0) === 0 &&
            (currentVars[0].subRecipes?.length || 0) === 0 &&
            (currentVars[0].packaging?.length || 0) === 0;

          const nextVariants = hasOnlyBlankPlaceholder ? [newVariant] : [...currentVars, newVariant];
          setEditingDish({ ...editingDish, variants: nextVariants });
          setActiveDishVariantIndex(nextVariants.length - 1);
          setIsPrimaryOptionPickerOpen(false);
        };

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-neutral-950/70 backdrop-blur-xs">
            <div className="modal-panel-fixed bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-orange-200">
              <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChefHat className="w-5 h-5" />
                  <h3 className="font-extrabold text-base">
                    {selectedCostMenu
                      ? lang === 'th'
                        ? `เลือกตัวเลือกหลักของเมนู "${selectedCostMenu.name}"`
                        : `Select Primary Option for "${getLocalizedText(lang, selectedCostMenu.name, selectedCostMenu.englishName)}"`
                      : lang === 'th'
                      ? 'เลือกตัวเลือกหลักจากต้นทุนอาหาร'
                      : 'Select Primary Option from Food Cost'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPrimaryOptionPickerOpen(false)}
                  className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search & Step/Tab Bar */}
              <div className="shrink-0 p-3 border-b border-neutral-200 bg-neutral-50 space-y-2">
                {selectedCostMenu ? (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCostMenuId(null);
                        setPrimaryOptionSearch('');
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-orange-50 border border-orange-300 text-orange-700 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>{lang === 'th' ? 'เปลี่ยนรายการเมนูอาหาร' : 'Change Menu Item'}</span>
                    </button>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-extrabold text-neutral-700">
                        {lang === 'th' ? 'เมนูที่เลือก: ' : 'Selected Menu: '}
                        <span className="text-orange-600">
                          {getLocalizedText(lang, selectedCostMenu.name, selectedCostMenu.englishName)}
                        </span>{' '}
                        ({selectedMenuVariants.length} {lang === 'th' ? 'ตัวเลือก' : 'options'})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDish({
                            ...editingDish,
                            costMenuId: selectedCostMenu.id,
                          });
                          setIsPrimaryOptionPickerOpen(false);
                        }}
                        className="px-3 py-1 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer hover:brightness-105"
                      >
                        {lang === 'th'
                          ? `เชื่อมตัวเลือกทั้งหมด (${selectedMenuVariants.length})`
                          : `Link All Options (${selectedMenuVariants.length})`}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerSourceTab('menus');
                        setPrimaryOptionSearch('');
                      }}
                      className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                        pickerSourceTab === 'menus'
                          ? 'bg-orange-500 text-white'
                          : 'bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {lang === 'th'
                        ? `เลือกจากรายการเมนู (${sortedCostMenus.length})`
                        : `From Food Cost Menus (${sortedCostMenus.length})`}
                    </button>
                    {proteinIngredients.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPickerSourceTab('ingredients');
                          setPrimaryOptionSearch('');
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                          pickerSourceTab === 'ingredients'
                            ? 'bg-orange-500 text-white'
                            : 'bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        {lang === 'th' ? 'เลือกจากวัตถุดิบเนื้อสัตว์เดี่ยว' : 'From Single Protein Ingredients'}
                      </button>
                    )}
                  </div>
                )}

                <div className="relative">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    autoFocus
                    value={primaryOptionSearch}
                    onChange={(e) => setPrimaryOptionSearch(e.target.value)}
                    placeholder={
                      selectedCostMenu
                        ? lang === 'th'
                          ? `ค้นหาตัวเลือกในเมนู "${selectedCostMenu.name}" (เช่น หมู, ไก่, ทะเล)...`
                          : `Search options in "${getLocalizedText(lang, selectedCostMenu.name, selectedCostMenu.englishName)}"...`
                        : pickerSourceTab === 'menus'
                          ? lang === 'th'
                            ? 'ค้นหารายการเมนูอาหาร (เช่น ข้าวผัด, กะเพรา, ผัดไทย)...'
                            : 'Search Food Cost menus (e.g. Fried Rice, Basil, Pad Thai)...'
                          : lang === 'th'
                            ? 'ค้นหาวัตถุดิบเนื้อสัตว์...'
                            : 'Search protein ingredients...'
                    }
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="modal-body space-y-3">
                {isImportingCostOption && (
                  <div className="p-2 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700 font-bold text-center">
                    {lang === 'th' ? 'กำลังนำเข้าข้อมูลต้นทุน...' : 'Importing Food Cost data...'}
                  </div>
                )}

                {pickerSourceTab === 'menus' && !selectedCostMenu && (
                  <div className="space-y-2">
                    <div className="text-xs font-extrabold text-neutral-800">
                      {lang === 'th'
                        ? `เลือกรายการเมนูอาหารที่ต้องการ (${filteredMenus.length} เมนู)`
                        : `Select Menu Item (${filteredMenus.length} menus)`}
                    </div>

                    {filteredMenus.length === 0 ? (
                      <div className="p-6 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 text-xs text-neutral-500 text-center">
                        {lang === 'th'
                          ? 'ไม่พบรายการเมนูอาหารในระบบต้นทุนที่ตรงกับคำค้นหา'
                          : 'No matching Food Cost menus found'}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {filteredMenus.map((menu) => {
                          const mNameLower = `${menu.name} ${menu.englishName || ''}`.toLowerCase();
                          const isDishMatch = Boolean(
                            (dishThLower && (mNameLower.includes(dishThLower) || dishThLower.includes(mNameLower))) ||
                              (dishEnLower && mNameLower.includes(dishEnLower))
                          );
                          const activeVarCount = (menu.variants || []).length;

                          return (
                            <button
                              key={menu.id}
                              type="button"
                              onClick={() => {
                                setSelectedCostMenuId(menu.id);
                                setPrimaryOptionSearch('');
                              }}
                              className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer hover:shadow-md active:scale-[0.99] flex items-center justify-between gap-3 ${
                                isDishMatch
                                  ? 'bg-orange-50/70 border-orange-300 hover:border-orange-500'
                                  : 'bg-white border-neutral-200 hover:border-orange-400'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-black text-sm text-neutral-900 truncate">
                                    {getLocalizedText(lang, menu.name, menu.englishName)}
                                  </span>
                                  {isDishMatch && (
                                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-orange-500 text-white shrink-0">
                                      {lang === 'th' ? 'ตรงกับเมนูนี้' : 'Matches Dish'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-neutral-500 mt-0.5">
                                  {getLocalizedText(lang, menu.category || 'เมนูอาหาร')} •{' '}
                                  {lang === 'th'
                                    ? `มี ${activeVarCount} ตัวเลือกหลัก`
                                    : `${activeVarCount} primary options`}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-orange-500 shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {pickerSourceTab === 'menus' && selectedCostMenu && (
                  <div className="space-y-2">
                    <div className="text-xs font-extrabold text-neutral-800">
                      {lang === 'th'
                        ? `ตัวเลือกที่มีใน "${selectedCostMenu.name}" (${selectedMenuVariants.length} รายการ)`
                        : `Options in "${getLocalizedText(lang, selectedCostMenu.name, selectedCostMenu.englishName)}" (${selectedMenuVariants.length} items)`}
                    </div>

                    {selectedMenuVariants.length === 0 ? (
                      <div className="p-6 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 text-xs text-neutral-500 text-center">
                        {lang === 'th'
                          ? `ไม่พบตัวเลือกที่ตรงกับคำค้นหาในเมนู "${selectedCostMenu.name}"`
                          : `No matching options in "${getLocalizedText(lang, selectedCostMenu.name, selectedCostMenu.englishName)}"`}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {selectedMenuVariants.map(({ variant, sellingPrice, cost, dineInProfit, takeawayProfit }) => {
                          const displayOptionLabel = getCostVariantLabel(variant);

                          return (
                            <button
                              key={`${selectedCostMenu.id}_${variant.id}`}
                              type="button"
                              disabled={isImportingCostOption}
                              onClick={async () => {
                                setIsImportingCostOption(true);
                                try {
                                  const converted = await importCostingVariantToDishVariant({
                                    variant,
                                    costMenuId: selectedCostMenu.id,
                                    costIngredients,
                                    costSauces,
                                    preferredNameTh: displayOptionLabel,
                                  });
                                  converted.price = sellingPrice;
                                  await appendImportedVariant(converted);
                                } finally {
                                  setIsImportingCostOption(false);
                                }
                              }}
                              className="p-3 rounded-2xl border bg-white border-neutral-200 hover:border-orange-400 hover:bg-orange-50/40 text-left transition-all cursor-pointer hover:shadow-md active:scale-[0.99] disabled:opacity-60"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-black text-sm text-neutral-900 truncate">
                                    {getLocalizedText(lang, displayOptionLabel, variant.englishName)}
                                  </div>
                                  <div className="text-[11px] text-neutral-500 truncate">
                                    {getLocalizedText(lang, selectedCostMenu.name, selectedCostMenu.englishName)}
                                  </div>
                                </div>
                                <span className="text-xs font-black text-orange-600 shrink-0">
                                  ฿{formatMoney(sellingPrice || 0)}
                                </span>
                              </div>

                              <div className="mt-2 pt-1.5 border-t border-neutral-200/70 grid grid-cols-3 gap-1.5 text-center text-[10px]">
                                <div>
                                  <span className="text-neutral-500 block">
                                    {lang === 'th' ? 'ต้นทุน' : 'Cost'}
                                  </span>
                                  <span className="font-black text-neutral-900">
                                    ฿{formatMoney(cost)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-neutral-500 block">
                                    {lang === 'th' ? 'กำไรต่อจาน' : 'Dine-in Profit'}
                                  </span>
                                  <span
                                    className={`font-extrabold ${
                                      dineInProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                    }`}
                                  >
                                    {dineInProfit > 0 ? '+' : ''}฿{formatMoney(dineInProfit)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-neutral-500 block">
                                    {lang === 'th' ? 'กำไรใส่กล่อง' : 'Takeaway Profit'}
                                  </span>
                                  <span
                                    className={`font-extrabold ${
                                      takeawayProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                    }`}
                                  >
                                    {takeawayProfit > 0 ? '+' : ''}฿{formatMoney(takeawayProfit)}
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {pickerSourceTab === 'ingredients' && !selectedCostMenu && (
                  <div className="space-y-2">
                    <div className="text-xs font-extrabold text-neutral-800">
                      {lang === 'th'
                        ? `เลือกจากวัตถุดิบเนื้อสัตว์ในคลังต้นทุน (${proteinIngredients.length})`
                        : `Select from Protein Ingredients (${proteinIngredients.length})`}
                    </div>
                    {proteinIngredients.length === 0 ? (
                      <div className="p-6 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 text-xs text-neutral-500 text-center">
                        {lang === 'th' ? 'ไม่พบวัตถุดิบเนื้อสัตว์ที่ตรงกับคำค้นหา' : 'No matching protein ingredients found'}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {proteinIngredients.map((ing) => (
                          <button
                            key={ing.id}
                            type="button"
                            disabled={isImportingCostOption}
                            onClick={async () => {
                              setIsImportingCostOption(true);
                              try {
                                const converted = await importCostingIngredientAsDishVariant(ing, 100);
                                converted.price = editingDish.variants?.[0]?.price || 65;
                                await appendImportedVariant(converted);
                              } finally {
                                setIsImportingCostOption(false);
                              }
                            }}
                            className="p-2.5 bg-neutral-50 hover:bg-orange-50 rounded-xl border border-neutral-200 hover:border-orange-300 text-left cursor-pointer flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-neutral-900 truncate">
                                {getLocalizedText(lang, ing.name, ing.englishName)}
                              </div>
                              <div className="text-[10px] text-neutral-500">
                                ฿{formatMoney(ing.costPerBaseUnit)} / {ing.baseUnit}
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-orange-600 shrink-0">
                              {lang === 'th' ? '+ เลือกใช้' : '+ Select'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const newVar: DishVariant = {
                      id: `var_${Date.now()}`,
                      nameTh: '',
                      name: '',
                      price: editingDish.variants?.[0]?.price || 100,
                      ingredients: [],
                      subRecipes: [],
                      packaging: [],
                    };
                    const nextVars = [...(editingDish.variants || []), newVar];
                    setEditingDish({ ...editingDish, variants: nextVars });
                    setActiveDishVariantIndex(nextVars.length - 1);
                    setIsPrimaryOptionPickerOpen(false);
                  }}
                  className="px-3.5 py-1.5 bg-white hover:bg-neutral-50 text-orange-700 border border-orange-300 rounded-xl text-xs font-bold cursor-pointer"
                >
                  {lang === 'th' ? '+ สร้างตัวเลือกหลักใหม่เอง' : '+ Create Custom Option'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrimaryOptionPickerOpen(false)}
                  className="px-4 py-1.5 bg-neutral-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  {t.common.close}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* OPTION GROUP PICKER MODAL ("เพิ่มตัวเลือกย่อยที่ใช้งาน") */}
      {/* ========================================================= */}
      {isOptionGroupPickerOpen && editingDish && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-neutral-950/70 backdrop-blur-xs">
          <div className="modal-panel bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-orange-200">
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5" />
                <h3 className="font-extrabold text-base">
                  {lang === 'th' ? 'เลือกตัวเลือกย่อยที่ใช้งาน' : 'Select Active Sub-Option Groups'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOptionGroupPickerOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="shrink-0 p-3 border-b border-neutral-200 bg-neutral-50">
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  autoFocus
                  value={optionGroupSearch}
                  onChange={(e) => setOptionGroupSearch(e.target.value)}
                  placeholder={lang === 'th' ? 'ค้นหากลุ่มตัวเลือกย่อย...' : 'Search sub-option groups...'}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl"
                />
              </div>
            </div>

            <div className="modal-body space-y-2">
              {optionGroups.length === 0 ? (
                <div className="p-4 text-center text-xs text-neutral-500">
                  {lang === 'th'
                    ? 'ยังไม่มีกลุ่มตัวเลือกย่อย กรุณาสร้างในเมนู "กลุ่มตัวเลือกเสริม" ก่อน'
                    : 'No sub-option groups yet. Create one in Option Groups first.'}
                </div>
              ) : (
                optionGroups
                  .filter((grp) => {
                    const q = optionGroupSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      grp.name.toLowerCase().includes(q) ||
                      (grp.nameTh && grp.nameTh.toLowerCase().includes(q))
                    );
                  })
                  .map((grp) => {
                    const isSelected = (editingDish.optionGroupIds || []).includes(grp.id);
                    return (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => {
                          const curr = editingDish.optionGroupIds || [];
                          const next = isSelected
                            ? curr.filter((id) => id !== grp.id)
                            : [...curr, grp.id];
                          setEditingDish({ ...editingDish, optionGroupIds: next });
                        }}
                        className={`w-full p-3 rounded-2xl border text-left cursor-pointer transition-colors flex items-start justify-between gap-2 ${
                          isSelected
                            ? 'bg-orange-50 border-orange-500'
                            : 'bg-white border-neutral-200 hover:bg-neutral-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-extrabold text-xs text-neutral-900">
                            {lang === 'th' ? grp.nameTh || grp.name : grp.name || grp.nameTh}
                            {grp.nameTh && grp.name && grp.name !== grp.nameTh && lang === 'th' && (
                              <span className="ml-1.5 text-[10px] font-medium text-neutral-400">
                                ({grp.name})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-neutral-500 mt-0.5">
                            {grp.choices
                              .map((c) => (lang === 'th' ? c.nameTh || c.name : c.name || c.nameTh))
                              .join(' • ')}
                          </div>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${
                            isSelected
                              ? 'bg-orange-500 border-orange-600 text-white'
                              : 'bg-white border-neutral-300 text-transparent'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    );
                  })
              )}
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end">
              <button
                type="button"
                onClick={() => setIsOptionGroupPickerOpen(false)}
                className="px-5 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {lang === 'th'
                  ? `ตกลง (${(editingDish.optionGroupIds || []).length})`
                  : `Done (${(editingDish.optionGroupIds || []).length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        title={
          pendingDelete?.type === 'dish'
            ? lang === 'th'
              ? 'ยืนยันการลบเมนู'
              : 'Delete Menu Item'
            : pendingDelete?.type === 'category'
            ? lang === 'th'
              ? 'ยืนยันการลบหมวดหมู่'
              : 'Delete Category'
            : lang === 'th'
            ? 'ยืนยันการลบช่องทางขาย'
            : 'Delete Channel'
        }
        message={
          lang === 'th'
            ? `ต้องการลบ "${pendingDelete?.label || ''}" ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`
            : `Are you sure you want to delete "${pendingDelete?.label || ''}"?`
        }
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setPendingDelete(null);
        }}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setIsDeleting(true);
          try {
            const col =
              pendingDelete.type === 'dish'
                ? 'dishes'
                : pendingDelete.type === 'category'
                ? 'categories'
                : 'channels';
            await deleteDocument(col, pendingDelete.id);
            setPendingDelete(null);
            loadData();
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </div>
  );
};
