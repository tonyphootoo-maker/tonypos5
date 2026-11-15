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
import { translateThaiToEnglish, computeAutoEnglishName } from '../utils/thaiToEnglish';
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
import { calculateVariantCostBreakdown } from '../costing/services/calculationEngine';
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
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
}

type TabType = 'dishes' | 'categories' | 'channels';

export const MenuFoodCostPage: React.FC<Props> = ({ settings, lang }) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<TabType>('dishes');

  // Master collections
  const [ingredients, setIngredients] = useState<IngredientDoc[]>([]);
  const [subRecipes, setSubRecipes] = useState<SubRecipeDoc[]>([]);
  const [packagings, setPackagings] = useState<PackagingDoc[]>([]);
  const [dishes, setDishes] = useState<DishDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [channels, setChannels] = useState<ChannelDoc[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [dishImages, setDishImages] = useState<Map<string, string>>(new Map());

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

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

  // Tracks which English inputs were manually customized in the current modal session
  const manualEnKeysRef = useRef<Set<string>>(new Set());
  const loadedDishImageIdsRef = useRef<Map<string, string>>(new Map());

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
        if (cloudMenus.length > 0) setCostMenus(cloudMenus);
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
          const targetVar = targetMenu?.variants?.find((cv) => cv.id === variant.costVariantId);
          if (targetMenu && targetVar) return { menu: targetMenu, variant: targetVar };
        }
        for (const cm of activeCostMenus) {
          const cv = (cm.variants || []).find((x) => x.id === variant.costVariantId);
          if (cv) return { menu: cm, variant: cv };
        }
      }

      // 2. Shared variant ID (from syncCostingMenuToPOS)
      if (variant?.id) {
        for (const cm of activeCostMenus) {
          const cv = (cm.variants || []).find((x) => x.id === variant.id);
          if (cv) return { menu: cm, variant: cv };
        }
      }

      // 3. Match CostMenu at dish level
      const dTh = (dish.nameTh || '').trim().toLowerCase();
      const dEn = (dish.name || '').trim().toLowerCase();
      const normalizedCostId = dish.id?.startsWith('cost_dish_')
        ? dish.id.replace('cost_dish_', '')
        : '';

      let matchedMenu: CostMenuItem | undefined =
        (dish.costMenuId && activeCostMenus.find((m) => m.id === dish.costMenuId)) ||
        (variant?.costMenuId && activeCostMenus.find((m) => m.id === variant.costMenuId)) ||
        (normalizedCostId
          ? activeCostMenus.find(
              (m) => m.id.replace(/[^a-zA-Z0-9_-]/g, '_') === normalizedCostId
            )
          : undefined);

      if (!matchedMenu) {
        matchedMenu = activeCostMenus.find((m) => {
          const cmName = m.name.trim().toLowerCase();
          return (dTh && cmName === dTh) || (dEn && cmName === dEn);
        });
      }

      if (!matchedMenu && (dTh.length >= 2 || dEn.length >= 2)) {
        const candidates = activeCostMenus.filter((m) => {
          const cmName = m.name.trim().toLowerCase();
          return (
            (dTh.length >= 2 && (cmName.includes(dTh) || dTh.includes(cmName))) ||
            (dEn.length >= 2 && (cmName.includes(dEn) || dEn.includes(cmName)))
          );
        });
        if (candidates.length === 1) {
          matchedMenu = candidates[0];
        }
      }

      if (matchedMenu && (matchedMenu.variants || []).length > 0) {
        const activeVars = matchedMenu.variants.filter((cv) => cv.active !== false);
        const pool = activeVars.length > 0 ? activeVars : matchedMenu.variants;

        if (!variant) {
          return { menu: matchedMenu, variant: pool[0] };
        }

        const vTh = (variant.nameTh || '').trim().toLowerCase();
        const vEn = (variant.name || '').trim().toLowerCase();

        const exactVar = pool.find((cv) => {
          const p = (cv.proteinType || '').trim().toLowerCase();
          const n = (cv.name || '').trim().toLowerCase();
          return (
            (vTh && (p === vTh || n === vTh)) ||
            (vEn && (p === vEn || n === vEn))
          );
        });
        if (exactVar) return { menu: matchedMenu, variant: exactVar };

        if (vTh === 'มาตรฐาน' || vEn === 'standard') {
          return { menu: matchedMenu, variant: pool[0] };
        }

        const partialVar = pool.find((cv) => {
          const p = (cv.proteinType || '').trim().toLowerCase();
          const n = (cv.name || '').trim().toLowerCase();
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
      const posPrice =
        variant?.price && variant.price > 0
          ? variant.price
          : match.variant.sellingPrice || 0;
      const baseCostingPrice = match.variant.sellingPrice || posPrice;
      const boxMarkup =
        match.variant.takeawayPrice && match.variant.takeawayPrice > baseCostingPrice
          ? match.variant.takeawayPrice - baseCostingPrice
          : 0;
      const effectiveTakeawayPrice = posPrice + boxMarkup;

      const breakdown = calculateVariantCostBreakdown(
        {
          ...match.variant,
          sellingPrice: posPrice,
          takeawayPrice: effectiveTakeawayPrice,
        },
        match.menu.name,
        costIngMap,
        costSauceMap,
        costSettings
      );

      return {
        hasData: true,
        source: 'food_cost' as const,
        matchedMenuName: match.menu.name,
        matchedVariantName: match.variant.proteinType || match.variant.name,
        cost: breakdown.totalCost,
        ingredientCost: breakdown.totalIngredientCost,
        dineInProfit: breakdown.restaurantProfit,
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
          matchedMenuName: dish.nameTh || dish.name || '',
          matchedVariantName: variant.nameTh || variant.name,
          cost: posCalc.totalCost,
          ingredientCost: posCalc.foodCost,
          dineInProfit: netDineIn - posCalc.totalCost,
          takeawayProfit: netTakeaway - (posCalc.totalCost + takeawayBoxCost),
        };
      }
    }

    return {
      hasData: false,
      source: 'none' as const,
      matchedMenuName: '',
      matchedVariantName: '',
      cost: 0,
      ingredientCost: 0,
      dineInProfit: 0,
      takeawayProfit: 0,
    };
  };

  const openEditDish = (dish: DishDoc) => {
    manualEnKeysRef.current.clear();
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
    setEditingDish({
      ...dish,
      variants: (dish.variants || []).map((v) => ({
        ...v,
        ingredients: [...(v.ingredients || [])],
        subRecipes: [...(v.subRecipes || [])],
        packaging: [...(v.packaging || [])],
      })),
      optionGroupIds: [...(dish.optionGroupIds || [])],
    });
    setActiveDishVariantIndex(0);
    loadCostingCatalog();
    setIsDishModalOpen(true);
  };

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

  const handleSaveDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDish) return;

    const finalDishTh = (editingDish.nameTh || '').trim();
    const finalDishEn =
      (editingDish.name || '').trim() ||
      (finalDishTh ? translateThaiToEnglish(finalDishTh) : '');
    if (!finalDishEn && !finalDishTh) return;

    const normalizedVariants: DishVariant[] = (editingDish.variants || []).map((v) => {
      const vTh = (v.nameTh || '').trim();
      const vEn =
        (v.name || '').trim() ||
        (vTh ? translateThaiToEnglish(vTh) : '') ||
        'Standard';
      return {
        ...v,
        name: vEn,
        ...(vTh ? { nameTh: vTh } : {}),
        price: Number(v.price) || 0,
        ingredients: v.ingredients || [],
        subRecipes: v.subRecipes || [],
        packaging: v.packaging || [],
      };
    });

    const isNew = !editingDish.id;
    const dishToSave: DishDoc = {
      id: editingDish.id || `dish_${Date.now()}`,
      name: finalDishEn || finalDishTh,
      ...(finalDishTh ? { nameTh: finalDishTh } : {}),
      categoryId: editingDish.categoryId || categories[0]?.id || 'cat_main',
      ...(editingDish.imageId ? { imageId: editingDish.imageId } : {}),
      ...(editingDish.description ? { description: editingDish.description } : {}),
      ...(editingDish.costMenuId ? { costMenuId: editingDish.costMenuId } : {}),
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
    setIsDishModalOpen(false);
    setEditingDish(null);
    setEditingDishPreviewUrl(null);
    setEditingDishImageSizeKb(null);
    setImageUploadError(null);
    loadData();
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 select-none">
      {/* Title & Tabs Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6 text-orange-600" />
            <span>{t.menuCost.title}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            {lang === 'th'
              ? 'เพิ่ม ลบ แก้ไข เมนูหน้าร้าน POS • เชื่อมโยงต้นทุนและกำไรจริงจากส่วนต้นทุนอาหารอัตโนมัติ'
              : 'Manage front-of-house POS menu items • Real cost & profits synced live from Food Cost'}
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
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
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap shadow-2xs active:scale-95 ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-xs'
                : 'bg-white text-neutral-700 hover:bg-orange-50/60 border border-neutral-200'
            }`}
          >
            {tab.label} <span className="opacity-80">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* ========================================================= */}
      {/* TAB: MENU ITEMS (POS FRONT-OF-HOUSE) */}
      {/* ========================================================= */}
      {activeTab === 'dishes' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-neutral-600">
              Showing {dishes.length} dishes
            </span>
            <button
              onClick={() => {
                manualEnKeysRef.current.clear();
                setEditingDishPreviewUrl(null);
                setEditingDishImageSizeKb(null);
                setImageUploadError(null);
                setEditingDish({
                  name: '',
                  nameTh: '',
                  categoryId: categories[0]?.id || 'cat_main',
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
                });
                setActiveDishVariantIndex(0);
                loadCostingCatalog();
                setIsDishModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.menuCost.addDish}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {dishes
              .filter(
                (d) =>
                  d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (d.nameTh && d.nameTh.toLowerCase().includes(searchQuery.toLowerCase()))
              )
              .map((dish) => {
                const imgDataUrl = dishImages.get(dish.id);
                const primaryVariant = dish.variants[0];
                const metrics = getLinkedFoodCostMetrics(dish, primaryVariant);
                const catObj = categories.find((c) => c.id === dish.categoryId);
                const catLabel = lang === 'th' && catObj?.nameTh ? catObj.nameTh : catObj?.name || 'ทั่วไป';
                const primaryVarLabel = primaryVariant
                  ? (lang === 'th' && primaryVariant.nameTh ? primaryVariant.nameTh : primaryVariant.name)
                  : '';

                return (
                  <div
                    key={dish.id}
                    onDoubleClick={() => openEditDish(dish)}
                    title={lang === 'th' ? 'ดับเบิลคลิกเพื่อแก้ไขเมนู' : 'Double-click to edit menu'}
                    className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs hover:shadow-md hover:border-orange-300 transition-all flex flex-col justify-between cursor-pointer"
                  >
                    <div>
                      {/* Dish Photo & Basic Info */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-16 h-16 rounded-xl bg-neutral-100 overflow-hidden shrink-0 border border-neutral-200 flex items-center justify-center">
                          {imgDataUrl ? (
                            <img
                              src={imgDataUrl}
                              alt={dish.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Utensils className="w-6 h-6 text-neutral-300" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="font-black text-sm text-neutral-900 truncate">
                            {lang === 'th' && dish.nameTh ? dish.nameTh : dish.name}
                          </h4>
                          <p className="text-[11px] text-neutral-500 truncate">{catLabel}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-xs font-black text-orange-600">
                              ฿{formatMoney(primaryVariant?.price || 0)}
                            </span>
                            {dish.variants.length > 1 && (
                              <span className="text-[10px] text-neutral-500 font-semibold">
                                ({dish.variants.length} {lang === 'th' ? 'ตัวเลือก' : 'options'})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Real Cost & Profits Linked from Food Cost ("ต้นทุนอาหาร") */}
                      <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-100 space-y-2 text-xs">
                        {!metrics.hasData ? (
                          <div className="py-1.5 px-2 text-center text-[11px] font-semibold text-neutral-500">
                            {lang === 'th'
                              ? 'ยังไม่เชื่อมข้อมูลต้นทุนในส่วนต้นทุนอาหาร'
                              : 'Not linked to Food Cost yet'}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500">
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                <Link2 className="w-3 h-3 shrink-0" />
                                {metrics.source === 'food_cost'
                                  ? lang === 'th'
                                    ? 'เชื่อมข้อมูลจากต้นทุนอาหาร'
                                    : 'Synced from Food Cost'
                                  : lang === 'th'
                                  ? 'ข้อมูลสูตรเมนู'
                                  : 'Menu Formula'}
                              </span>
                              {dish.variants.length > 1 && primaryVarLabel && (
                                <span className="truncate max-w-[120px] font-medium">
                                  {primaryVarLabel}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-1.5 text-center">
                              <div className="p-1.5 bg-white rounded-lg border border-neutral-200">
                                <div className="text-[10px] font-bold text-neutral-500">
                                  {lang === 'th' ? 'ต้นทุน' : 'Cost'}
                                </div>
                                <div className="text-xs font-black text-neutral-900 mt-0.5">
                                  ฿{formatMoney(metrics.cost)}
                                </div>
                              </div>

                              <div className="p-1.5 bg-white rounded-lg border border-neutral-200">
                                <div className="text-[10px] font-bold text-neutral-500">
                                  {lang === 'th' ? 'กำไรต่อจาน' : 'Dine-In Profit'}
                                </div>
                                <div
                                  className={`text-xs font-black mt-0.5 ${
                                    metrics.dineInProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                  }`}
                                >
                                  {metrics.dineInProfit > 0 ? '+' : ''}฿{formatMoney(metrics.dineInProfit)}
                                </div>
                              </div>

                              <div className="p-1.5 bg-white rounded-lg border border-neutral-200">
                                <div className="text-[10px] font-bold text-neutral-500">
                                  {lang === 'th' ? 'กำไรใส่กล่อง' : 'Takeaway Profit'}
                                </div>
                                <div
                                  className={`text-xs font-black mt-0.5 ${
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

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-neutral-100">
                      <span className="text-[10px] text-neutral-400 font-medium">
                        {lang === 'th' ? 'ดับเบิลคลิกการ์ดเพื่อแก้ไข' : 'Double-click card to edit'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDish(dish);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                          title={t.common.edit}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm(`Delete ${dish.nameTh || dish.name}?`)) {
                              await deleteDocument('dishes', dish.id);
                              loadData();
                            }
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
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
                manualEnKeysRef.current.clear();
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
                      manualEnKeysRef.current.clear();
                      setEditingCategory(cat);
                      setIsCategoryModalOpen(true);
                    }}
                    className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Delete ${cat.name}?`)) {
                        await deleteDocument('categories', cat.id);
                        loadData();
                      }
                    }}
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
                manualEnKeysRef.current.clear();
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
                      manualEnKeysRef.current.clear();
                      setEditingChannel(ch);
                      setIsChannelModalOpen(true);
                    }}
                    className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Delete ${ch.name}?`)) {
                        await deleteDocument('channels', ch.id);
                        loadData();
                      }
                    }}
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

      {/* ========================================================= */}
      {/* DISH MODAL (POS FRONT-OF-HOUSE MENU EDITOR) */}
      {/* ========================================================= */}
      {isDishModalOpen && editingDish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveDish}
            className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base">
                  {editingDish.id ? t.menuCost.editDish : t.menuCost.addDish}
                </h3>
                <p className="text-xs text-orange-100">
                  {lang === 'th'
                    ? 'จัดการข้อมูลเมนูสำหรับขายหน้าร้าน POS'
                    : 'POS Menu Details & Selling Options'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDishModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Dish Name Thai-first + Auto-EN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    ชื่อเมนู (ภาษาไทย) *
                  </label>
                  <input
                    type="text"
                    required={!editingDish.name}
                    value={editingDish.nameTh || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      const nextEn = computeAutoEnglishName({
                        previousThai: editingDish.nameTh || '',
                        nextThai: nextTh,
                        currentEnglish: editingDish.name || '',
                        isManuallyEdited: manualEnKeysRef.current.has('dish'),
                      });
                      setEditingDish({ ...editingDish, nameTh: nextTh, name: nextEn });
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                    placeholder="เช่น ผัดกะเพรา, ข้าวผัด"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-neutral-700">
                      {t.menuCost.dishName} (EN)
                    </label>
                    {editingDish.nameTh && (
                      <button
                        type="button"
                        onClick={() => {
                          manualEnKeysRef.current.delete('dish');
                          setEditingDish({
                            ...editingDish,
                            name: translateThaiToEnglish(editingDish.nameTh || ''),
                          });
                        }}
                        className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer"
                      >
                        แปลใหม่
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={editingDish.name || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.trim()) manualEnKeysRef.current.add('dish');
                      else manualEnKeysRef.current.delete('dish');
                      setEditingDish({ ...editingDish, name: val });
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                    placeholder="e.g. Stir-Fried Holy Basil"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.dishCategory}
                  </label>
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

              {/* Primary Options Section ("ตัวเลือกหลักของเมนู") */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-xs font-bold text-neutral-800">{t.menuCost.variants}</span>
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
                    <Plus className="w-3.5 h-3.5" />
                    <span>เพิ่มตัวเลือกหลัก</span>
                  </button>
                </div>

                {/* Primary Option Tabs */}
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
                      <span>{v.nameTh || v.name}</span>
                      <span className="opacity-90">(฿{formatMoney(v.price)})</span>
                    </button>
                  ))}
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
                            ชื่อตัวเลือกหลัก (ภาษาไทย) *
                          </label>
                          <input
                            type="text"
                            required={!currVar.name}
                            value={currVar.nameTh || ''}
                            onChange={(e) => {
                              const nextTh = e.target.value;
                              const updated = [...(editingDish.variants || [])];
                              const prev = updated[activeDishVariantIndex];
                              const nextEn = computeAutoEnglishName({
                                previousThai: prev.nameTh || '',
                                nextThai: nextTh,
                                currentEnglish: prev.name || '',
                                isManuallyEdited: manualEnKeysRef.current.has(`var_${currVar.id}`),
                              });
                              updated[activeDishVariantIndex] = {
                                ...prev,
                                nameTh: nextTh,
                                name: nextEn,
                              };
                              setEditingDish({ ...editingDish, variants: updated });
                            }}
                            className="w-full px-2.5 py-1 text-xs bg-white border border-orange-300 rounded-lg"
                            placeholder="เช่น หมูหมัก, ไก่, ทะเล"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] font-bold text-neutral-600">
                              ชื่อ EN
                            </label>
                            {currVar.nameTh && (
                              <button
                                type="button"
                                onClick={() => {
                                  manualEnKeysRef.current.delete(`var_${currVar.id}`);
                                  const updated = [...(editingDish.variants || [])];
                                  updated[activeDishVariantIndex] = {
                                    ...updated[activeDishVariantIndex],
                                    name: translateThaiToEnglish(currVar.nameTh || ''),
                                  };
                                  setEditingDish({ ...editingDish, variants: updated });
                                }}
                                className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer"
                              >
                                แปลใหม่
                              </button>
                            )}
                          </div>
                          <input
                            type="text"
                            value={currVar.name || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              const key = `var_${currVar.id}`;
                              if (val.trim()) manualEnKeysRef.current.add(key);
                              else manualEnKeysRef.current.delete(key);
                              const updated = [...(editingDish.variants || [])];
                              updated[activeDishVariantIndex] = {
                                ...updated[activeDishVariantIndex],
                                name: val,
                              };
                              setEditingDish({ ...editingDish, variants: updated });
                            }}
                            className="w-full px-2.5 py-1 text-xs bg-neutral-100/70 border border-neutral-300 rounded-lg"
                            placeholder="e.g. Marinated Pork"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] font-bold text-neutral-600">
                              ราคาขาย (บาท)
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
                                <span>ลบตัวเลือกนี้</span>
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
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold flex items-center gap-1.5">
                            {varMetrics.hasData ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>
                                  {varMetrics.source === 'food_cost'
                                    ? `เชื่อมข้อมูลจริงจากต้นทุนอาหาร (${varMetrics.matchedMenuName} • ${varMetrics.matchedVariantName})`
                                    : 'เชื่อมข้อมูลต้นทุนจากสูตรเมนู'}
                                </span>
                              </>
                            ) : (
                              <span className="text-neutral-500">
                                {lang === 'th'
                                  ? 'ยังไม่เชื่อมสูตรในส่วนต้นทุนอาหาร'
                                  : 'Not linked to Food Cost yet'}
                              </span>
                            )}
                          </span>
                        </div>

                        {varMetrics.hasData && (
                          <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-emerald-200/70 text-center">
                            <div>
                              <span className="text-[10px] text-neutral-600 block">ต้นทุน</span>
                              <span className="font-black text-neutral-900">
                                ฿{formatMoney(varMetrics.cost)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-neutral-600 block">กำไรต่อจาน</span>
                              <span
                                className={`font-black ${
                                  varMetrics.dineInProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                }`}
                              >
                                {varMetrics.dineInProfit > 0 ? '+' : ''}฿{formatMoney(varMetrics.dineInProfit)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-neutral-600 block">กำไรใส่กล่อง</span>
                              <span
                                className={`font-black ${
                                  varMetrics.takeawayProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                }`}
                              >
                                {varMetrics.takeawayProfit > 0 ? '+' : ''}฿{formatMoney(varMetrics.takeawayProfit)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
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
                    <span>เพิ่มตัวเลือกย่อย</span>
                  </button>
                </div>

                {(() => {
                  const selectedGroups = optionGroups.filter((grp) =>
                    (editingDish.optionGroupIds || []).includes(grp.id)
                  );
                  if (selectedGroups.length === 0) {
                    return (
                      <div className="p-2.5 bg-white rounded-xl border border-dashed border-neutral-300 text-[11px] text-neutral-500 text-center">
                        ยังไม่ได้เลือกตัวเลือกย่อย กดปุ่ม &quot;+ เพิ่มตัวเลือกย่อย&quot; เพื่อเลือกจากกลุ่มที่สร้างไว้
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
                              {grp.nameTh || grp.name}
                              {grp.nameTh && grp.name && grp.name !== grp.nameTh && (
                                <span className="ml-1 text-[10px] font-medium text-neutral-400">
                                  ({grp.name})
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-500 truncate mt-0.5">
                              {grp.choices.map((c) => c.nameTh || c.name).join(', ')}
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
                            title="นำออก"
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

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsDishModalOpen(false)}
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
              const finalTh = (editingCategory.nameTh || '').trim();
              const finalEn =
                (editingCategory.name || '').trim() ||
                (finalTh ? translateThaiToEnglish(finalTh) : '');
              if (!finalEn && !finalTh) return;
              const isNew = !editingCategory.id;
              const catToSave: CategoryDoc = {
                id: editingCategory.id || `cat_${Date.now()}`,
                name: finalEn || finalTh,
                ...(finalTh ? { nameTh: finalTh } : {}),
                order: editingCategory.order || categories.length + 1,
                createdAt: editingCategory.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: editingCategory.version || 1,
              };
              await saveDocument('categories', catToSave, isNew);
              setIsCategoryModalOpen(false);
              setEditingCategory(null);
              loadData();
            }}
            className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.menuCost.addCategory}</h3>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  ชื่อหมวดหมู่ (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  required={!editingCategory.name}
                  value={editingCategory.nameTh || ''}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    const nextEn = computeAutoEnglishName({
                      previousThai: editingCategory.nameTh || '',
                      nextThai: nextTh,
                      currentEnglish: editingCategory.name || '',
                      isManuallyEdited: manualEnKeysRef.current.has('cat'),
                    });
                    setEditingCategory({ ...editingCategory, nameTh: nextTh, name: nextEn });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl"
                  placeholder="เช่น อาหารจานหลัก, เครื่องดื่ม"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-neutral-700">
                    {t.menuCost.categoryName} (EN)
                  </label>
                  {editingCategory.nameTh && (
                    <button
                      type="button"
                      onClick={() => {
                        manualEnKeysRef.current.delete('cat');
                        setEditingCategory({
                          ...editingCategory,
                          name: translateThaiToEnglish(editingCategory.nameTh || ''),
                        });
                      }}
                      className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer"
                    >
                      แปลใหม่
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={editingCategory.name || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim()) manualEnKeysRef.current.add('cat');
                    else manualEnKeysRef.current.delete('cat');
                    setEditingCategory({ ...editingCategory, name: val });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. Main Dishes"
                />
              </div>
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
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
              const finalTh = (editingChannel.nameTh || '').trim();
              const finalEn =
                (editingChannel.name || '').trim() ||
                (finalTh ? translateThaiToEnglish(finalTh) : '');
              if (!finalEn && !finalTh) return;
              const isNew = !editingChannel.id;
              const chToSave: ChannelDoc = {
                id: editingChannel.id || `ch_${Date.now()}`,
                name: finalEn || finalTh,
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
            className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.menuCost.addChannel}</h3>
              <button
                type="button"
                onClick={() => setIsChannelModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  ชื่อช่องทางขาย (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  required={!editingChannel.name}
                  value={editingChannel.nameTh || ''}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    const nextEn = computeAutoEnglishName({
                      previousThai: editingChannel.nameTh || '',
                      nextThai: nextTh,
                      currentEnglish: editingChannel.name || '',
                      isManuallyEdited: manualEnKeysRef.current.has('ch'),
                    });
                    setEditingChannel({ ...editingChannel, nameTh: nextTh, name: nextEn });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl"
                  placeholder="เช่น หน้าร้าน, กลับบ้าน, GrabFood"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-neutral-700">
                    {t.menuCost.channelName} (EN)
                  </label>
                  {editingChannel.nameTh && (
                    <button
                      type="button"
                      onClick={() => {
                        manualEnKeysRef.current.delete('ch');
                        setEditingChannel({
                          ...editingChannel,
                          name: translateThaiToEnglish(editingChannel.nameTh || ''),
                        });
                      }}
                      className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer"
                    >
                      แปลใหม่
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={editingChannel.name || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim()) manualEnKeysRef.current.add('ch');
                    else manualEnKeysRef.current.delete('ch');
                    setEditingChannel({ ...editingChannel, name: val });
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

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
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

        const costIngMap = new Map<string, CostIngredient>(costIngredients.map((i) => [i.id, i]));
        const costSauceMap = new Map<string, CostSauce>(costSauces.map((s) => [s.id, s]));

        // Sort costing menus so matching dish name comes first
        const sortedCostMenus = [...costMenus]
          .filter((m) => m.active !== false && (m.variants || []).some((v) => v.active !== false))
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
          cost: number;
          dineInProfit: number;
          takeawayProfit: number;
        }> = [];

        if (selectedCostMenu) {
          for (const v of selectedCostMenu.variants || []) {
            if (v.active === false) continue;
            const hay = `${v.name} ${v.proteinType || ''}`.toLowerCase();
            if (q && !hay.includes(q)) continue;

            const bd = calculateVariantCostBreakdown(
              v,
              selectedCostMenu.name,
              costIngMap,
              costSauceMap,
              costSettings
            );

            selectedMenuVariants.push({
              variant: v,
              cost: bd.totalCost || 0,
              dineInProfit: bd.restaurantProfit || 0,
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
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col border border-orange-200 overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChefHat className="w-5 h-5" />
                  <div>
                    <h3 className="font-extrabold text-base">
                      {selectedCostMenu
                        ? `เลือกตัวเลือกหลักของเมนู "${selectedCostMenu.name}"`
                        : 'เลือกตัวเลือกหลักจากต้นทุนอาหาร'}
                    </h3>
                    <p className="text-[11px] text-orange-100">
                      {selectedCostMenu
                        ? 'แสดงเฉพาะตัวเลือกที่มีอยู่ในรายการเมนูที่เลือกเท่านั้น'
                        : 'ขั้นตอนที่ 1: เลือกรายการเมนูอาหารก่อน จากนั้นเลือกตัวเลือกของเมนูนั้นๆ'}
                    </p>
                  </div>
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
              <div className="p-3 border-b border-neutral-200 bg-neutral-50 space-y-2">
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
                      <span>เปลี่ยนรายการเมนูอาหาร</span>
                    </button>
                    <span className="text-xs font-extrabold text-neutral-700">
                      เมนูที่เลือก: <span className="text-orange-600">{selectedCostMenu.name}</span> ({selectedMenuVariants.length} ตัวเลือก)
                    </span>
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
                      เลือกจากรายการเมนู ({sortedCostMenus.length})
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
                        เลือกจากวัตถุดิบเนื้อสัตว์เดี่ยว
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
                        ? `ค้นหาตัวเลือกในเมนู "${selectedCostMenu.name}" (เช่น หมู, ไก่, ทะเล)...`
                        : pickerSourceTab === 'menus'
                          ? 'ค้นหารายการเมนูอาหาร (เช่น ข้าวผัด, กะเพรา, ผัดไทย)...'
                          : 'ค้นหาวัตถุดิบเนื้อสัตว์...'
                    }
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isImportingCostOption && (
                  <div className="p-2 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700 font-bold text-center">
                    กำลังนำเข้าข้อมูลต้นทุน...
                  </div>
                )}

                {pickerSourceTab === 'menus' && !selectedCostMenu && (
                  <div className="space-y-2">
                    <div className="text-xs font-extrabold text-neutral-800">
                      เลือกรายการเมนูอาหารที่ต้องการ ({filteredMenus.length} เมนู)
                    </div>

                    {filteredMenus.length === 0 ? (
                      <div className="p-6 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 text-xs text-neutral-500 text-center">
                        ไม่พบรายการเมนูอาหารในระบบต้นทุนที่ตรงกับคำค้นหา
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {filteredMenus.map((menu) => {
                          const mNameLower = menu.name.toLowerCase();
                          const isDishMatch = Boolean(
                            (dishThLower && (mNameLower.includes(dishThLower) || dishThLower.includes(mNameLower))) ||
                              (dishEnLower && mNameLower.includes(dishEnLower))
                          );
                          const activeVarCount = (menu.variants || []).filter((v) => v.active !== false).length;

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
                                    {menu.name}
                                  </span>
                                  {isDishMatch && (
                                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-orange-500 text-white shrink-0">
                                      ตรงกับเมนูนี้
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-neutral-500 mt-0.5">
                                  {menu.category || 'เมนูอาหาร'} • มี {activeVarCount} ตัวเลือกหลัก
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
                      ตัวเลือกที่มีใน "{selectedCostMenu.name}" ({selectedMenuVariants.length} รายการ)
                    </div>

                    {selectedMenuVariants.length === 0 ? (
                      <div className="p-6 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 text-xs text-neutral-500 text-center">
                        ไม่พบตัวเลือกที่ตรงกับคำค้นหาในเมนู "{selectedCostMenu.name}"
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {selectedMenuVariants.map(({ variant, cost, dineInProfit, takeawayProfit }) => {
                          const displayProtein =
                            variant.proteinType &&
                            variant.proteinType !== 'ทั่วไป' &&
                            variant.proteinType !== 'Standard'
                              ? variant.proteinType
                              : variant.name;

                          return (
                            <button
                              key={`${selectedCostMenu.id}_${variant.id}`}
                              type="button"
                              disabled={isImportingCostOption}
                              onClick={async () => {
                                setIsImportingCostOption(true);
                                try {
                                  const alreadyExists = (editingDish.variants || []).some(
                                    (ev) => (ev.nameTh || ev.name) === displayProtein
                                  );
                                  const preferredNameTh = alreadyExists ? variant.name : displayProtein;
                                  const converted = await importCostingVariantToDishVariant({
                                    variant,
                                    costMenuId: selectedCostMenu.id,
                                    costIngredients,
                                    costSauces,
                                    preferredNameTh,
                                  });
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
                                    {displayProtein}
                                  </div>
                                  <div className="text-[11px] text-neutral-500 truncate">
                                    {selectedCostMenu.name} • {variant.name}
                                  </div>
                                </div>
                                <span className="text-xs font-black text-orange-600 shrink-0">
                                  ฿{formatMoney(variant.sellingPrice || 0)}
                                </span>
                              </div>

                              <div className="mt-2 pt-1.5 border-t border-neutral-200/70 grid grid-cols-3 gap-1.5 text-center text-[10px]">
                                <div>
                                  <span className="text-neutral-500 block">ต้นทุน</span>
                                  <span className="font-black text-neutral-900">
                                    ฿{formatMoney(cost)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-neutral-500 block">กำไรต่อจาน</span>
                                  <span
                                    className={`font-extrabold ${
                                      dineInProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                    }`}
                                  >
                                    {dineInProfit > 0 ? '+' : ''}฿{formatMoney(dineInProfit)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-neutral-500 block">กำไรใส่กล่อง</span>
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
                      เลือกจากวัตถุดิบเนื้อสัตว์ในคลังต้นทุน ({proteinIngredients.length})
                    </div>
                    {proteinIngredients.length === 0 ? (
                      <div className="p-6 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 text-xs text-neutral-500 text-center">
                        ไม่พบวัตถุดิบเนื้อสัตว์ที่ตรงกับคำค้นหา
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
                              <div className="text-xs font-bold text-neutral-900 truncate">{ing.name}</div>
                              <div className="text-[10px] text-neutral-500">
                                ฿{formatMoney(ing.costPerBaseUnit)} / {ing.baseUnit}
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-orange-600 shrink-0">
                              + เลือกใช้
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-2">
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
                  + สร้างตัวเลือกหลักใหม่เอง
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
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[84vh] flex flex-col border border-orange-200 overflow-hidden">
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5" />
                <div>
                  <h3 className="font-extrabold text-base">เลือกตัวเลือกย่อยที่ใช้งาน</h3>
                  <p className="text-[11px] text-orange-100">
                    เลือกกลุ่มตัวเลือกเสริมที่ต้องการนำมาใช้งานกับเมนูนี้
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOptionGroupPickerOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 border-b border-neutral-200 bg-neutral-50">
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  autoFocus
                  value={optionGroupSearch}
                  onChange={(e) => setOptionGroupSearch(e.target.value)}
                  placeholder="ค้นหากลุ่มตัวเลือกย่อย..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {optionGroups.length === 0 ? (
                <div className="p-4 text-center text-xs text-neutral-500">
                  ยังไม่มีกลุ่มตัวเลือกย่อย กรุณาสร้างในเมนู &quot;กลุ่มตัวเลือกเสริม&quot; ก่อน
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
                            {grp.nameTh || grp.name}
                            {grp.nameTh && grp.name && grp.name !== grp.nameTh && (
                              <span className="ml-1.5 text-[10px] font-medium text-neutral-400">
                                ({grp.name})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-neutral-500 mt-0.5">
                            {grp.choices.map((c) => c.nameTh || c.name).join(' • ')}
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

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end">
              <button
                type="button"
                onClick={() => setIsOptionGroupPickerOpen(false)}
                className="px-5 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                ตกลง ({(editingDish.optionGroupIds || []).length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
