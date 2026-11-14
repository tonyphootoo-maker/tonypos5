import React, { useState, useEffect, useRef } from 'react';
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
  calculateIngredientCostPerBaseUnit,
  calculateIngredientEffectiveCost,
  calculateSubRecipeCost,
  calculateDishVariantCost,
  calculateSuggestedPricing,
  calculateFoodCostPercent,
  calculateItemContributionMargin,
  extractNetPriceFromMenuPrice,
  isMissingCost,
  formatMoney,
  formatPercent,
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
  AlertTriangle,
  Upload,
  CheckCircle2,
  X,
  Search,
  Check,
  ChefHat,
  Sliders,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
}

type TabType = 'ingredients' | 'sub_recipes' | 'packaging' | 'dishes' | 'categories' | 'channels';

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
  const [isIngredientModalOpen, setIsIngredientModalOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Partial<IngredientDoc> | null>(null);

  const [isSubRecipeModalOpen, setIsSubRecipeModalOpen] = useState(false);
  const [editingSubRecipe, setEditingSubRecipe] = useState<Partial<SubRecipeDoc> | null>(null);

  const [isPackagingModalOpen, setIsPackagingModalOpen] = useState(false);
  const [editingPackaging, setEditingPackaging] = useState<Partial<PackagingDoc> | null>(null);

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

  // Compute live Maps for dynamic costing
  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));
  const subRecipesMap = new Map<string, SubRecipeDoc>(subRecipes.map((s) => [s.id, s]));
  const packagingMap = new Map<string, PackagingDoc>(packagings.map((p) => [p.id, p]));

  // ==========================================
  // INGREDIENTS HANDLERS
  // ==========================================
  const handleSaveIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIngredient) return;

    const finalTh = (editingIngredient.nameTh || '').trim();
    const finalEn =
      (editingIngredient.name || '').trim() ||
      (finalTh ? translateThaiToEnglish(finalTh) : '');
    if (!finalEn && !finalTh) return;

    const isNew = !editingIngredient.id;
    const price = editingIngredient.purchasePrice || 0;
    const qty = editingIngredient.purchaseQuantity || 1;
    const yieldPct = editingIngredient.yieldPercent || 100;
    const unit = editingIngredient.purchaseUnit || 'kg';
    const costMethod = editingIngredient.costMethod || 'latest';

    const calc = calculateIngredientCostPerBaseUnit(price, qty, yieldPct, unit);

    const existing = !isNew ? ingredients.find((i) => i.id === editingIngredient.id) : null;
    let updatedPriceHistory = editingIngredient.priceHistory ? [...editingIngredient.priceHistory] : [];

    if (isNew) {
      updatedPriceHistory = [
        {
          date: new Date().toISOString().split('T')[0],
          price,
          yieldPercent: yieldPct,
        },
      ];
    } else if (existing && (existing.purchasePrice !== price || existing.yieldPercent !== yieldPct)) {
      updatedPriceHistory.push({
        date: new Date().toISOString().split('T')[0],
        price,
        yieldPercent: yieldPct,
      });
    }

    const ingToSave: IngredientDoc = {
      id: editingIngredient.id || `ing_${Date.now()}`,
      name: finalEn || finalTh,
      ...(finalTh ? { nameTh: finalTh } : {}),
      purchaseUnit: unit,
      purchasePrice: price,
      purchaseQuantity: qty,
      yieldPercent: yieldPct,
      baseUnit: calc.baseUnit,
      costPerBaseUnit: calc.costPerBaseUnit,
      costMethod,
      priceHistory: updatedPriceHistory,
      createdAt: editingIngredient.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingIngredient.version || 1,
    };

    await saveDocument('ingredients', ingToSave, isNew);
    setIsIngredientModalOpen(false);
    setEditingIngredient(null);
    loadData();
  };

  // ==========================================
  // SUB-RECIPE HANDLERS
  // ==========================================
  const handleSaveSubRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubRecipe) return;

    const finalTh = (editingSubRecipe.nameTh || '').trim();
    const finalEn =
      (editingSubRecipe.name || '').trim() ||
      (finalTh ? translateThaiToEnglish(finalTh) : '');
    if (!finalEn && !finalTh) return;

    const isNew = !editingSubRecipe.id;
    const subToSave: SubRecipeDoc = {
      id: editingSubRecipe.id || `sub_${Date.now()}`,
      name: finalEn || finalTh,
      ...(finalTh ? { nameTh: finalTh } : {}),
      outputUnit: editingSubRecipe.outputUnit || 'portion',
      outputQuantity: editingSubRecipe.outputQuantity || 1,
      ingredients: editingSubRecipe.ingredients || [],
      subRecipes: editingSubRecipe.subRecipes || [],
      createdAt: editingSubRecipe.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingSubRecipe.version || 1,
    };

    await saveDocument('subRecipes', subToSave, isNew);
    setIsSubRecipeModalOpen(false);
    setEditingSubRecipe(null);
    loadData();
  };

  // ==========================================
  // PACKAGING HANDLERS
  // ==========================================
  const handleSavePackaging = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPackaging) return;

    const finalTh = (editingPackaging.nameTh || '').trim();
    const finalEn =
      (editingPackaging.name || '').trim() ||
      (finalTh ? translateThaiToEnglish(finalTh) : '');
    if (!finalEn && !finalTh) return;

    const isNew = !editingPackaging.id;
    const pkgToSave: PackagingDoc = {
      id: editingPackaging.id || `pkg_${Date.now()}`,
      name: finalEn || finalTh,
      ...(finalTh ? { nameTh: finalTh } : {}),
      cost: editingPackaging.cost || 0,
      unit: editingPackaging.unit || 'piece',
      createdAt: editingPackaging.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingPackaging.version || 1,
    };

    await saveDocument('packaging', pkgToSave, isNew);
    setIsPackagingModalOpen(false);
    setEditingPackaging(null);
    loadData();
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
            Target Food Cost: <strong className="text-orange-600 font-extrabold">{settings.targetFoodCostPercent}%</strong> • Dynamic automatic cost cascade
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

      {/* Tab Navigation Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-orange-200">
        {[
          { id: 'dishes', label: t.menuCost.tabDishes, count: dishes.length },
          { id: 'ingredients', label: t.menuCost.tabIngredients, count: ingredients.length },
          { id: 'sub_recipes', label: t.menuCost.tabSubRecipes, count: subRecipes.length },
          { id: 'packaging', label: t.menuCost.tabPackaging, count: packagings.length },
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
      {/* TAB: DISHES & RECIPES */}
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
                      price: 100,
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
                // Evaluate primary variant
                const primaryVariant = dish.variants[0];
                const costCalc = primaryVariant
                  ? calculateDishVariantCost(primaryVariant, ingredientsMap, subRecipesMap, packagingMap)
                  : { totalCost: 0, foodCost: 0, packagingCost: 0, ingredientsCost: 0, subRecipesCost: 0, hasRecipe: false, hasMissing: true };

                const primaryNetPrice = primaryVariant
                  ? extractNetPriceFromMenuPrice(
                      primaryVariant.price,
                      settings.pricesIncludeVat,
                      settings.vatPercent,
                      settings.serviceChargeIncludedInPrice,
                      settings.serviceChargePercent
                    )
                  : 0;

                const foodCostPct = primaryVariant
                  ? calculateFoodCostPercent(costCalc.foodCost, primaryNetPrice)
                  : 0;

                const primaryProfit = primaryVariant
                  ? calculateItemContributionMargin(primaryNetPrice, costCalc.foodCost, 0, 0)
                  : { contributionMargin: 0, contributionMarginPercent: 0 };

                const suggestedPricing = calculateSuggestedPricing(
                  costCalc.foodCost || costCalc.totalCost,
                  settings.targetFoodCostPercent,
                  settings.pricesIncludeVat,
                  settings.vatPercent,
                  settings.serviceChargeIncludedInPrice,
                  settings.serviceChargePercent,
                  settings.priceRounding || 5
                );

                const isOverTarget = foodCostPct > settings.targetFoodCostPercent;

                return (
                  <div
                    key={dish.id}
                    className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
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
                          <p className="text-[11px] text-neutral-500">
                            {categories.find((c) => c.id === dish.categoryId)?.name || 'Category'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-xs font-black text-neutral-800">
                              ฿{formatMoney(primaryVariant?.price || 0)}
                            </span>
                            {dish.variants.length > 1 && (
                              <span className="text-[10px] text-neutral-500 font-semibold">
                                ({dish.variants.length} variants)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Food Cost Metrics */}
                      <div className="p-2.5 bg-neutral-50 rounded-xl space-y-1.5 text-xs">
                        {!costCalc.hasRecipe ? (
                          <div className="p-1.5 bg-amber-50 text-amber-800 rounded-lg text-[11px] font-bold flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            <span>{t.pos.noRecipeLinked}</span>
                          </div>
                        ) : (
                          <>
                            {costCalc.hasMissing && (
                              <div className="p-1 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-[10px] font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                                <span>{t.menuCost.missingCost}</span>
                              </div>
                            )}

                            <div className="flex justify-between">
                              <span className="text-neutral-500">Food COGS:</span>
                              <span className="font-bold text-neutral-900">฿{formatMoney(costCalc.foodCost)}</span>
                            </div>

                            <div className="flex justify-between">
                              <span className="text-neutral-500">{t.menuCost.grossProfit}:</span>
                              <span
                                className={`font-bold ${
                                  primaryProfit.contributionMargin > 0 ? 'text-emerald-700' : 'text-rose-600'
                                }`}
                              >
                                ฿{formatMoney(primaryProfit.contributionMargin)} ({formatPercent(primaryProfit.contributionMarginPercent)})
                              </span>
                            </div>

                            {costCalc.packagingCost > 0 && (
                              <div className="flex justify-between text-[11px] text-neutral-500">
                                <span>Packaging:</span>
                                <span>฿{formatMoney(costCalc.packagingCost)}</span>
                              </div>
                            )}

                            <div className="flex justify-between items-center">
                              <span className="text-neutral-500">{t.menuCost.theoreticalFoodCost}:</span>
                              <span
                                className={`font-extrabold px-1.5 py-0.5 rounded-md text-[11px] ${
                                  isOverTarget
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {formatPercent(foodCostPct)}
                              </span>
                            </div>

                            {isOverTarget && (
                              <div className="flex justify-between text-[11px] text-orange-700 font-semibold pt-1 border-t border-neutral-200">
                                <span>{t.menuCost.suggestedMenuPrice}:</span>
                                <span>฿{formatMoney(suggestedPricing.suggestedMenuPrice)}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-neutral-100">
                      <button
                        onClick={() => {
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
                        }}
                        className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                        title={t.common.edit}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Delete ${dish.name}?`)) {
                            await deleteDocument('dishes', dish.id);
                            loadData();
                          }
                        }}
                        className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                        title={t.common.delete}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: INGREDIENTS */}
      {/* ========================================================= */}
      {activeTab === 'ingredients' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-neutral-600">
              Showing {ingredients.length} raw ingredients
            </span>
            <button
              onClick={() => {
                manualEnKeysRef.current.clear();
                setEditingIngredient({
                  name: '',
                  nameTh: '',
                  purchaseUnit: 'kg',
                  purchasePrice: 100,
                  purchaseQuantity: 1,
                  yieldPercent: 100,
                  costMethod: 'latest',
                });
                setIsIngredientModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.menuCost.addIngredient}</span>
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="p-3">{t.menuCost.ingredientName}</th>
                    <th className="p-3">{t.menuCost.purchasePrice}</th>
                    <th className="p-3">{t.menuCost.yieldPercent}</th>
                    <th className="p-3">{t.menuCost.costPerUnit}</th>
                    <th className="p-3 text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 font-medium">
                  {ingredients
                    .filter(
                      (i) =>
                        i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (i.nameTh && i.nameTh.toLowerCase().includes(searchQuery.toLowerCase()))
                    )
                    .map((ing) => {
                      const effectiveCost = calculateIngredientEffectiveCost(ing);
                      const missing = isMissingCost(effectiveCost);
                      return (
                        <tr key={ing.id} className="hover:bg-orange-50/30">
                          <td className="p-3 font-bold text-neutral-900">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{lang === 'th' && ing.nameTh ? ing.nameTh : ing.name}</span>
                              {ing.costMethod === 'average' && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                  Avg 3x
                                </span>
                              )}
                              {missing && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 flex items-center gap-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  {t.menuCost.missingCost}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-neutral-700">
                            ฿{formatMoney(ing.purchasePrice)} / {ing.purchaseQuantity} {ing.purchaseUnit}
                          </td>
                          <td className="p-3 text-neutral-700">{ing.yieldPercent}%</td>
                          <td className={`p-3 font-bold ${missing ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {missing ? '—' : `฿${formatMoney(effectiveCost)} / ${ing.baseUnit}`}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => {
                                manualEnKeysRef.current.clear();
                                setEditingIngredient(ing);
                                setIsIngredientModalOpen(true);
                              }}
                              className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer mr-1"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm(`Delete ${ing.name}?`)) {
                                  await deleteDocument('ingredients', ing.id);
                                  loadData();
                                }
                              }}
                              className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: SUB-RECIPES */}
      {/* ========================================================= */}
      {activeTab === 'sub_recipes' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-neutral-600">
              Showing {subRecipes.length} prepared sub-recipes
            </span>
            <button
              onClick={() => {
                manualEnKeysRef.current.clear();
                setEditingSubRecipe({
                  name: '',
                  nameTh: '',
                  outputUnit: 'portion',
                  outputQuantity: 10,
                  ingredients: [],
                });
                setIsSubRecipeModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.menuCost.addSubRecipe}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {subRecipes.map((sub) => {
              const calc = calculateSubRecipeCost(sub, ingredientsMap, subRecipesMap);
              return (
                <div
                  key={sub.id}
                  className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-black text-sm text-neutral-900">
                        {lang === 'th' && sub.nameTh ? sub.nameTh : sub.name}
                      </h4>
                      {calc.hasMissing && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 flex items-center gap-0.5 shrink-0">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{t.menuCost.missingCost}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500">
                      Batch Output: {sub.outputQuantity} {sub.outputUnit}
                    </p>

                    <div className="p-2.5 bg-neutral-50 rounded-xl space-y-1 text-xs">
                      <div className="flex justify-between text-neutral-600">
                        <span>Total Batch Cost:</span>
                        <span className="font-bold">฿{formatMoney(calc.totalBatchCost)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-800 font-extrabold pt-1 border-t border-neutral-200">
                        <span>Cost / {sub.outputUnit}:</span>
                        <span>฿{formatMoney(calc.costPerOutputUnit)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-neutral-100">
                    <button
                      onClick={() => {
                        manualEnKeysRef.current.clear();
                        setEditingSubRecipe(sub);
                        setIsSubRecipeModalOpen(true);
                      }}
                      className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm(`Delete ${sub.name}?`)) {
                          await deleteDocument('subRecipes', sub.id);
                          loadData();
                        }
                      }}
                      className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: PACKAGING */}
      {/* ========================================================= */}
      {activeTab === 'packaging' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-neutral-600">
              Showing {packagings.length} packaging items
            </span>
            <button
              onClick={() => {
                manualEnKeysRef.current.clear();
                setEditingPackaging({ name: '', nameTh: '', cost: 5, unit: 'piece' });
                setIsPackagingModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.menuCost.addPackaging}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {packagings.map((pkg) => {
              const missingPkgCost = isMissingCost(pkg.cost);
              return (
                <div
                  key={pkg.id}
                  className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-black text-sm text-neutral-900">
                        {lang === 'th' && pkg.nameTh ? pkg.nameTh : pkg.name}
                      </h4>
                      {missingPkgCost && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 flex items-center gap-0.5 shrink-0">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>{t.menuCost.missingCost}</span>
                        </span>
                      )}
                    </div>
                    <div className={`text-base font-black mt-1 ${missingPkgCost ? 'text-rose-600' : 'text-orange-600'}`}>
                      {missingPkgCost ? '—' : `฿${formatMoney(pkg.cost)} / ${pkg.unit}`}
                    </div>
                  </div>

                <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-neutral-100">
                  <button
                    onClick={() => {
                      manualEnKeysRef.current.clear();
                      setEditingPackaging(pkg);
                      setIsPackagingModalOpen(true);
                    }}
                    className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Delete ${pkg.name}?`)) {
                        await deleteDocument('packaging', pkg.id);
                        loadData();
                      }
                    }}
                    className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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
      {/* INGREDIENT EDIT MODAL */}
      {/* ========================================================= */}
      {isIngredientModalOpen && editingIngredient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveIngredient}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {editingIngredient.id ? t.menuCost.editIngredient : t.menuCost.addIngredient}
              </h3>
              <button
                type="button"
                onClick={() => setIsIngredientModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  ชื่อวัตถุดิบ (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  required={!editingIngredient.name}
                  value={editingIngredient.nameTh || ''}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    const nextEn = computeAutoEnglishName({
                      previousThai: editingIngredient.nameTh || '',
                      nextThai: nextTh,
                      currentEnglish: editingIngredient.name || '',
                      isManuallyEdited: manualEnKeysRef.current.has('ing'),
                    });
                    setEditingIngredient({ ...editingIngredient, nameTh: nextTh, name: nextEn });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                  placeholder="เช่น สันในหมู, กุ้งสด"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-neutral-700">
                    {t.menuCost.ingredientName} (English — แปลอัตโนมัติ)
                  </label>
                  {editingIngredient.nameTh && (
                    <button
                      type="button"
                      onClick={() => {
                        manualEnKeysRef.current.delete('ing');
                        setEditingIngredient({
                          ...editingIngredient,
                          name: translateThaiToEnglish(editingIngredient.nameTh || ''),
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
                  value={editingIngredient.name || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim()) manualEnKeysRef.current.add('ing');
                    else manualEnKeysRef.current.delete('ing');
                    setEditingIngredient({ ...editingIngredient, name: val });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. Pork Tenderloin"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.purchasePrice}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    required
                    value={editingIngredient.purchasePrice || 0}
                    onChange={(e) =>
                      setEditingIngredient({ ...editingIngredient, purchasePrice: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.purchaseUnit}
                  </label>
                  <select
                    value={editingIngredient.purchaseUnit || 'kg'}
                    onChange={(e) =>
                      setEditingIngredient({ ...editingIngredient, purchaseUnit: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  >
                    <option value="kg">kg (กิโลกรัม)</option>
                    <option value="g">g (กรัม)</option>
                    <option value="l">l (ลิตร)</option>
                    <option value="ml">ml (มิลลิลิตร)</option>
                    <option value="piece">piece (ชิ้น/ฟอง)</option>
                    <option value="pack">pack (ห่อ/ลัง)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Pack Size / Quantity
                  </label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    required
                    value={editingIngredient.purchaseQuantity || 1}
                    onChange={(e) =>
                      setEditingIngredient({ ...editingIngredient, purchaseQuantity: parseFloat(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.yieldPercent}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    required
                    value={editingIngredient.yieldPercent || 100}
                    onChange={(e) =>
                      setEditingIngredient({ ...editingIngredient, yieldPercent: parseFloat(e.target.value) || 100 })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Costing Method (Latest vs Average of last 3) */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.menuCost.costMethod}
                </label>
                <select
                  value={editingIngredient.costMethod || 'latest'}
                  onChange={(e) =>
                    setEditingIngredient({
                      ...editingIngredient,
                      costMethod: e.target.value as 'latest' | 'average',
                    })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-medium"
                >
                  <option value="latest">{t.menuCost.costMethodLatest}</option>
                  <option value="average">{t.menuCost.costMethodAverage}</option>
                </select>
              </div>

              {/* Price History Preview */}
              {editingIngredient.priceHistory && editingIngredient.priceHistory.length > 0 && (
                <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-200">
                  <div className="text-[11px] font-bold text-neutral-600 mb-1">
                    {t.menuCost.priceHistory} ({editingIngredient.priceHistory.length})
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-1 text-[10px] text-neutral-500">
                    {editingIngredient.priceHistory.slice(-5).reverse().map((h, i) => (
                      <div key={i} className="flex justify-between py-0.5 border-b border-neutral-100 last:border-0">
                        <span>{h.date}</span>
                        <span>฿{formatMoney(h.price)} (Yield {h.yieldPercent}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsIngredientModalOpen(false)}
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
      {/* DISH & RECIPE BUILDER MODAL */}
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
                <p className="text-xs text-orange-100">{t.menuCost.recipeBuilder}</p>
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
                      {t.menuCost.dishName} (English — แปลอัตโนมัติ)
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

                {/* Compact Active Primary Option Editor (Cost card & Ingredients hidden to avoid clutter) */}
                {editingDish.variants?.[activeDishVariantIndex] && (() => {
                  const currVar = editingDish.variants[activeDishVariantIndex];
                  const linkedCount =
                    (currVar.ingredients?.length || 0) +
                    (currVar.subRecipes?.length || 0) +
                    (currVar.packaging?.length || 0);
                  const varCost =
                    linkedCount > 0
                      ? calculateDishVariantCost(currVar, ingredientsMap, subRecipesMap, packagingMap)
                      : null;
                  const currFoodCost = varCost?.foodCost || 0;
                  const currNetPrice = extractNetPriceFromMenuPrice(
                    currVar.price || 0,
                    settings.pricesIncludeVat,
                    settings.vatPercent,
                    settings.serviceChargeIncludedInPrice,
                    settings.serviceChargePercent
                  );
                  const currProfit = calculateItemContributionMargin(currNetPrice, currFoodCost, 0, 0);

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
                              English (แปลอัตโนมัติ)
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
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={currVar.price}
                            onChange={(e) => {
                              const updated = [...(editingDish.variants || [])];
                              updated[activeDishVariantIndex] = {
                                ...updated[activeDishVariantIndex],
                                price: parseFloat(e.target.value) || 0,
                              };
                              setEditingDish({ ...editingDish, variants: updated });
                            }}
                            className="w-full px-2.5 py-1 text-xs bg-white border border-neutral-300 rounded-lg font-bold"
                          />
                        </div>
                      </div>

                      <div
                        className={`px-3 py-2 rounded-xl border text-[11px] space-y-1 ${
                          linkedCount > 0 && varCost
                            ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                            : 'bg-white border-neutral-200 text-neutral-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold flex items-center gap-1.5">
                            {linkedCount > 0 && varCost ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>ผูกข้อมูลต้นทุนจากระบบต้นทุนอาหารอัตโนมัติแล้ว ({linkedCount} รายการ)</span>
                              </>
                            ) : (
                              <span className="text-neutral-500">ยังไม่ได้ผูกสูตรวัตถุดิบ (ต้นทุน ฿0.00)</span>
                            )}
                          </span>
                          <span className="font-extrabold shrink-0">
                            ต้นทุน ฿{formatMoney(currFoodCost)} บาท
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-200/70">
                          <span className="text-neutral-600 font-semibold">
                            กำไรที่คาดว่าจะได้รับ (หากตั้งราคาขาย ฿{formatMoney(currVar.price || 0)}):
                          </span>
                          <span
                            className={`font-black shrink-0 ${
                              currProfit.contributionMargin > 0 ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {currProfit.contributionMargin > 0 ? '+' : ''}฿{formatMoney(currProfit.contributionMargin)} บาท ({formatPercent(currProfit.contributionMarginPercent)})
                          </span>
                        </div>
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

      {/* SUB-RECIPE MODAL */}
      {isSubRecipeModalOpen && editingSubRecipe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveSubRecipe}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {editingSubRecipe.id ? t.menuCost.editSubRecipe : t.menuCost.addSubRecipe}
              </h3>
              <button
                type="button"
                onClick={() => setIsSubRecipeModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  ชื่อสูตรกึ่งสำเร็จรูป (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  required={!editingSubRecipe.name}
                  value={editingSubRecipe.nameTh || ''}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    const nextEn = computeAutoEnglishName({
                      previousThai: editingSubRecipe.nameTh || '',
                      nextThai: nextTh,
                      currentEnglish: editingSubRecipe.name || '',
                      isManuallyEdited: manualEnKeysRef.current.has('sub'),
                    });
                    setEditingSubRecipe({ ...editingSubRecipe, nameTh: nextTh, name: nextEn });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl"
                  placeholder="เช่น ซอสผัดกระทะมาตรฐาน, น้ำซุปกระดูก"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-neutral-700">
                    {t.menuCost.subRecipeName} (English — แปลอัตโนมัติ)
                  </label>
                  {editingSubRecipe.nameTh && (
                    <button
                      type="button"
                      onClick={() => {
                        manualEnKeysRef.current.delete('sub');
                        setEditingSubRecipe({
                          ...editingSubRecipe,
                          name: translateThaiToEnglish(editingSubRecipe.nameTh || ''),
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
                  value={editingSubRecipe.name || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim()) manualEnKeysRef.current.add('sub');
                    else manualEnKeysRef.current.delete('sub');
                    setEditingSubRecipe({ ...editingSubRecipe, name: val });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. House Stir-Fry Sauce"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.outputQuantity}
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={editingSubRecipe.outputQuantity || 1}
                    onChange={(e) =>
                      setEditingSubRecipe({ ...editingSubRecipe, outputQuantity: parseFloat(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.outputUnit}
                  </label>
                  <input
                    type="text"
                    required
                    value={editingSubRecipe.outputUnit || 'portion'}
                    onChange={(e) =>
                      setEditingSubRecipe({ ...editingSubRecipe, outputUnit: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSubRecipeModalOpen(false)}
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

      {/* PACKAGING MODAL */}
      {isPackagingModalOpen && editingPackaging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSavePackaging}
            className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">{t.menuCost.addPackaging}</h3>
              <button
                type="button"
                onClick={() => setIsPackagingModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  ชื่อบรรจุภัณฑ์ (ภาษาไทย) *
                </label>
                <input
                  type="text"
                  required={!editingPackaging.name}
                  value={editingPackaging.nameTh || ''}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    const nextEn = computeAutoEnglishName({
                      previousThai: editingPackaging.nameTh || '',
                      nextThai: nextTh,
                      currentEnglish: editingPackaging.name || '',
                      isManuallyEdited: manualEnKeysRef.current.has('pkg'),
                    });
                    setEditingPackaging({ ...editingPackaging, nameTh: nextTh, name: nextEn });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl"
                  placeholder="เช่น กล่องข้าว, แก้วน้ำ"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-neutral-700">
                    {t.menuCost.packagingName} (English — แปลอัตโนมัติ)
                  </label>
                  {editingPackaging.nameTh && (
                    <button
                      type="button"
                      onClick={() => {
                        manualEnKeysRef.current.delete('pkg');
                        setEditingPackaging({
                          ...editingPackaging,
                          name: translateThaiToEnglish(editingPackaging.nameTh || ''),
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
                  value={editingPackaging.name || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim()) manualEnKeysRef.current.add('pkg');
                    else manualEnKeysRef.current.delete('pkg');
                    setEditingPackaging({ ...editingPackaging, name: val });
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. Food Box, Drink Cup"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.menuCost.packagingCost}
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  required
                  value={editingPackaging.cost || 0}
                  onChange={(e) => setEditingPackaging({ ...editingPackaging, cost: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                />
              </div>
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPackagingModalOpen(false)}
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
                    {t.menuCost.categoryName} (English — แปลอัตโนมัติ)
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
                    {t.menuCost.channelName} (English — แปลอัตโนมัติ)
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
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={editingChannel.commissionPercent || 0}
                  onChange={(e) =>
                    setEditingChannel({ ...editingChannel, commissionPercent: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.menuCost.defaultPackagingCost}
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  required
                  value={editingChannel.packagingCost || 0}
                  onChange={(e) =>
                    setEditingChannel({ ...editingChannel, packagingCost: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.menuCost.priceMarkupPercent} (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={editingChannel.priceMarkupPercent || 0}
                  onChange={(e) =>
                    setEditingChannel({ ...editingChannel, priceMarkupPercent: parseFloat(e.target.value) || 0 })
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
          foodCost: number;
          foodCostPct: number;
          estimatedProfit: number;
          estimatedProfitPct: number;
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

            const foodCost = bd.totalIngredientCost || 0;
            const sellingPrice = v.sellingPrice || 0;
            const netSellingPrice = extractNetPriceFromMenuPrice(
              sellingPrice,
              settings.pricesIncludeVat,
              settings.vatPercent,
              settings.serviceChargeIncludedInPrice,
              settings.serviceChargePercent
            );
            const profitCalc = calculateItemContributionMargin(netSellingPrice, foodCost, 0, 0);

            selectedMenuVariants.push({
              variant: v,
              foodCost,
              foodCostPct: bd.restaurantFoodCostPercent || 0,
              estimatedProfit: profitCalc.contributionMargin,
              estimatedProfitPct: profitCalc.contributionMarginPercent,
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
                        {selectedMenuVariants.map(({ variant, foodCost, foodCostPct, estimatedProfit, estimatedProfitPct }) => {
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

                              <div className="mt-2 pt-1.5 border-t border-neutral-200/70 space-y-1 text-[10px]">
                                <div className="flex items-center justify-between text-neutral-600">
                                  <span>วัตถุดิบ {(variant.recipeItems || []).length} รายการ</span>
                                  <span className="font-bold text-neutral-800">
                                    ต้นทุน ฿{formatMoney(foodCost)} ({formatPercent(foodCostPct)})
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-neutral-500">
                                    กำไร (หากขาย ฿{formatMoney(variant.sellingPrice || 0)}):
                                  </span>
                                  <span
                                    className={`font-extrabold ${
                                      estimatedProfit > 0 ? 'text-emerald-700' : 'text-rose-600'
                                    }`}
                                  >
                                    {estimatedProfit > 0 ? '+' : ''}฿{formatMoney(estimatedProfit)} ({formatPercent(estimatedProfitPct)})
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
