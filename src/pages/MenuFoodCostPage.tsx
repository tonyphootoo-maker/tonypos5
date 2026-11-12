import React, { useState, useEffect } from 'react';
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
  RecipeIngredientItem,
  RecipeSubRecipeItem,
  RecipePackagingItem,
} from '../types';
import { translations } from '../i18n/translations';
import {
  calculateIngredientCostPerBaseUnit,
  calculateSubRecipeCost,
  calculateDishVariantCost,
  calculateSuggestedPrice,
  calculateFoodCostPercent,
  formatMoney,
  formatPercent,
  roundTo2,
} from '../engine/calculations';
import {
  fetchCollection,
  saveDocument,
  deleteDocument,
  saveImageDoc,
  getImageDoc,
} from '../data/db';
import { compressImage } from '../utils/imageCompressor';
import {
  UtensilsCrossed,
  Layers,
  Box,
  Utensils,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  Upload,
  CheckCircle2,
  Image as ImageIcon,
  DollarSign,
  TrendingUp,
  Percent,
  History,
  X,
  Search,
  Radio,
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

  // Load all references
  const loadData = async () => {
    const [ings, subs, pkgs, dshs, cats, chs, ogs] = await Promise.all([
      fetchCollection<IngredientDoc>('ingredients'),
      fetchCollection<SubRecipeDoc>('subRecipes'),
      fetchCollection<PackagingDoc>('packaging'),
      fetchCollection<DishDoc>('dishes'),
      fetchCollection<CategoryDoc>('categories'),
      fetchCollection<ChannelDoc>('channels'),
      fetchCollection<OptionGroupDoc>('optionGroups'),
    ]);

    setIngredients(ings);
    setSubRecipes(subs);
    setPackagings(pkgs);
    setDishes(dshs);
    setCategories(cats.sort((a, b) => a.order - b.order));
    setChannels(chs);
    setOptionGroups(ogs);

    // Preload dish images
    dshs.forEach((d) => {
      if (d.imageId) {
        getImageDoc(d.imageId).then((imgDoc) => {
          if (imgDoc?.dataUrl) {
            setDishImages((prev) => new Map(prev).set(d.id, imgDoc.dataUrl));
          }
        });
      }
    });
  };

  useEffect(() => {
    loadData();
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
    if (!editingIngredient || !editingIngredient.name) return;

    const isNew = !editingIngredient.id;
    const price = editingIngredient.purchasePrice || 0;
    const qty = editingIngredient.purchaseQuantity || 1;
    const yieldPct = editingIngredient.yieldPercent || 100;
    const unit = editingIngredient.purchaseUnit || 'kg';

    const calc = calculateIngredientCostPerBaseUnit(price, qty, yieldPct, unit);

    const updatedPriceHistory = editingIngredient.priceHistory || [];
    if (!isNew && editingIngredient.purchasePrice) {
      updatedPriceHistory.push({
        date: new Date().toISOString().split('T')[0],
        price,
        yieldPercent: yieldPct,
      });
    }

    const ingToSave: IngredientDoc = {
      id: editingIngredient.id || `ing_${Date.now()}`,
      name: editingIngredient.name,
      nameTh: editingIngredient.nameTh || undefined,
      purchaseUnit: unit,
      purchasePrice: price,
      purchaseQuantity: qty,
      yieldPercent: yieldPct,
      baseUnit: calc.baseUnit,
      costPerBaseUnit: calc.costPerBaseUnit,
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
    if (!editingSubRecipe || !editingSubRecipe.name) return;

    const isNew = !editingSubRecipe.id;
    const subToSave: SubRecipeDoc = {
      id: editingSubRecipe.id || `sub_${Date.now()}`,
      name: editingSubRecipe.name,
      nameTh: editingSubRecipe.nameTh || undefined,
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
    if (!editingPackaging || !editingPackaging.name) return;

    const isNew = !editingPackaging.id;
    const pkgToSave: PackagingDoc = {
      id: editingPackaging.id || `pkg_${Date.now()}`,
      name: editingPackaging.name,
      nameTh: editingPackaging.nameTh || undefined,
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
    const file = e.target.files?.[0];
    if (!file || !editingDish) return;

    setIsUploadingImage(true);
    try {
      const { dataUrl, sizeBytes } = await compressImage(file);
      const imageId = `img_${Date.now()}`;
      await saveImageDoc(imageId, dataUrl, sizeBytes);

      setEditingDish({ ...editingDish, imageId });
      setDishImages((prev) => new Map(prev).set(editingDish.id || 'preview', dataUrl));
    } catch (err) {
      console.error('Image compression error:', err);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSaveDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDish || !editingDish.name) return;

    const isNew = !editingDish.id;
    const dishToSave: DishDoc = {
      id: editingDish.id || `dish_${Date.now()}`,
      name: editingDish.name,
      nameTh: editingDish.nameTh || undefined,
      categoryId: editingDish.categoryId || categories[0]?.id || 'cat_main',
      imageId: editingDish.imageId || undefined,
      description: editingDish.description || undefined,
      variants: editingDish.variants?.length ? editingDish.variants : [
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
    setIsDishModalOpen(false);
    setEditingDish(null);
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
              .filter((d) => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((dish) => {
                const imgDataUrl = dishImages.get(dish.id);
                // Evaluate primary variant
                const primaryVariant = dish.variants[0];
                const costCalc = primaryVariant
                  ? calculateDishVariantCost(primaryVariant, ingredientsMap, subRecipesMap, packagingMap)
                  : { totalCost: 0, hasRecipe: false, hasMissing: true };

                const foodCostPct = primaryVariant
                  ? calculateFoodCostPercent(costCalc.totalCost, primaryVariant.price)
                  : 0;

                const suggestedPrice = calculateSuggestedPrice(
                  costCalc.totalCost,
                  settings.targetFoodCostPercent
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
                            <div className="flex justify-between">
                              <span className="text-neutral-500">{t.common.cost}:</span>
                              <span className="font-bold">฿{formatMoney(costCalc.totalCost)}</span>
                            </div>

                            <div className="flex justify-between items-center">
                              <span className="text-neutral-500">{t.menuCost.currentFoodCostPct}:</span>
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
                                <span>{t.menuCost.suggestedPrice}:</span>
                                <span>฿{formatMoney(suggestedPrice)}</span>
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
                          setEditingDish(dish);
                          setActiveDishVariantIndex(0);
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
                setEditingIngredient({
                  purchaseUnit: 'kg',
                  purchasePrice: 100,
                  purchaseQuantity: 1,
                  yieldPercent: 100,
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
                    .filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((ing) => (
                      <tr key={ing.id} className="hover:bg-orange-50/30">
                        <td className="p-3 font-bold text-neutral-900">
                          {lang === 'th' && ing.nameTh ? ing.nameTh : ing.name}
                        </td>
                        <td className="p-3 text-neutral-700">
                          ฿{formatMoney(ing.purchasePrice)} / {ing.purchaseQuantity} {ing.purchaseUnit}
                        </td>
                        <td className="p-3 text-neutral-700">{ing.yieldPercent}%</td>
                        <td className="p-3 font-bold text-emerald-700">
                          ฿{formatMoney(ing.costPerBaseUnit)} / {ing.baseUnit}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
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
                    ))}
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
                setEditingSubRecipe({
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
                    <h4 className="font-black text-sm text-neutral-900">
                      {lang === 'th' && sub.nameTh ? sub.nameTh : sub.name}
                    </h4>
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
                setEditingPackaging({ cost: 5, unit: 'piece' });
                setIsPackagingModalOpen(true);
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t.menuCost.addPackaging}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {packagings.map((pkg) => (
              <div
                key={pkg.id}
                className="p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <h4 className="font-black text-sm text-neutral-900">
                    {lang === 'th' && pkg.nameTh ? pkg.nameTh : pkg.name}
                  </h4>
                  <div className="text-base font-black text-orange-600 mt-1">
                    ฿{formatMoney(pkg.cost)} / {pkg.unit}
                  </div>
                </div>

                <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-neutral-100">
                  <button
                    onClick={() => {
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
            ))}
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
                setEditingCategory({ order: categories.length + 1 });
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
                setEditingChannel({ type: 'delivery', commissionPercent: 30, packagingCost: 10 });
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
                      <span>Commission / GP:</span>
                      <span className="font-bold text-neutral-900">{ch.commissionPercent}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Packaging Cost:</span>
                      <span className="font-bold text-neutral-900">฿{formatMoney(ch.packagingCost)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-neutral-100">
                  <button
                    onClick={() => {
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
                  {t.menuCost.ingredientName} (English)
                </label>
                <input
                  type="text"
                  required
                  value={editingIngredient.name || ''}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. Pork Tenderloin"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.common.nameTh}
                </label>
                <input
                  type="text"
                  value={editingIngredient.nameTh || ''}
                  onChange={(e) => setEditingIngredient({ ...editingIngredient, nameTh: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. สันในหมู"
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
              {/* Dish Name & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.dishName} (EN)
                  </label>
                  <input
                    type="text"
                    required
                    value={editingDish.name || ''}
                    onChange={(e) => setEditingDish({ ...editingDish, name: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.common.nameTh}
                  </label>
                  <input
                    type="text"
                    value={editingDish.nameTh || ''}
                    onChange={(e) => setEditingDish({ ...editingDish, nameTh: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
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

                {/* Photo Upload (compressed to max 600px < 150KB) */}
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.dishImage}
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-orange-600" />
                      <span>{isUploadingImage ? 'Compressing...' : t.menuCost.uploadPhoto}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                    {editingDish.imageId && (
                      <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Variants & Recipe Builder */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-neutral-800">{t.menuCost.variants}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newVar: DishVariant = {
                        id: `var_${Date.now()}`,
                        name: 'New Variant',
                        price: 100,
                        ingredients: [],
                        subRecipes: [],
                        packaging: [],
                      };
                      setEditingDish({
                        ...editingDish,
                        variants: [...(editingDish.variants || []), newVar],
                      });
                      setActiveDishVariantIndex((editingDish.variants?.length || 0));
                    }}
                    className="text-xs text-orange-600 hover:text-orange-700 font-bold cursor-pointer"
                  >
                    {t.menuCost.addVariant}
                  </button>
                </div>

                {/* Variant Tabs */}
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {editingDish.variants?.map((v, idx) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setActiveDishVariantIndex(idx)}
                      className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap ${
                        activeDishVariantIndex === idx
                          ? 'bg-orange-500 text-white'
                          : 'bg-white border border-neutral-300 text-neutral-700'
                      }`}
                    >
                      {v.name} (฿{formatMoney(v.price)})
                    </button>
                  ))}
                </div>

                {/* Active Variant Recipe Editor */}
                {editingDish.variants?.[activeDishVariantIndex] && (() => {
                  const currVar = editingDish.variants[activeDishVariantIndex];
                  const varCost = calculateDishVariantCost(currVar, ingredientsMap, subRecipesMap, packagingMap);
                  const varFoodCostPct = calculateFoodCostPercent(varCost.totalCost, currVar.price);
                  const varSuggested = calculateSuggestedPrice(varCost.totalCost, settings.targetFoodCostPercent);
                  const isOver = varFoodCostPct > settings.targetFoodCostPercent;

                  return (
                    <div className="space-y-3 pt-2 border-t border-neutral-200">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                            {t.menuCost.variantName}
                          </label>
                          <input
                            type="text"
                            value={currVar.name}
                            onChange={(e) => {
                              const updated = [...(editingDish.variants || [])];
                              updated[activeDishVariantIndex].name = e.target.value;
                              setEditingDish({ ...editingDish, variants: updated });
                            }}
                            className="w-full px-2.5 py-1 text-xs bg-white border border-neutral-300 rounded-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                            Price (THB)
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={currVar.price}
                            onChange={(e) => {
                              const updated = [...(editingDish.variants || [])];
                              updated[activeDishVariantIndex].price = parseFloat(e.target.value) || 0;
                              setEditingDish({ ...editingDish, variants: updated });
                            }}
                            className="w-full px-2.5 py-1 text-xs bg-white border border-neutral-300 rounded-lg font-bold"
                          />
                        </div>
                      </div>

                      {/* Recipe Cost Metric Bar */}
                      <div className="p-2.5 bg-white rounded-xl border border-neutral-200 flex items-center justify-between text-xs">
                        <div>
                          <span className="text-neutral-500">Food Cost: </span>
                          <strong className="text-neutral-900">฿{formatMoney(varCost.totalCost)}</strong>
                        </div>
                        <div>
                          <span className="text-neutral-500">Food Cost %: </span>
                          <strong className={`px-1.5 py-0.5 rounded-md ${isOver ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}`}>
                            {formatPercent(varFoodCostPct)}
                          </strong>
                        </div>
                        <div>
                          <span className="text-neutral-500">Suggested: </span>
                          <strong className="text-orange-600">฿{formatMoney(varSuggested)}</strong>
                        </div>
                      </div>

                      {/* Recipe Ingredients List */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-[11px] font-bold text-neutral-700">
                          <span>Ingredients</span>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(editingDish.variants || [])];
                              const firstIng = ingredients[0]?.id || '';
                              updated[activeDishVariantIndex].ingredients = [
                                ...(updated[activeDishVariantIndex].ingredients || []),
                                { ingredientId: firstIng, quantity: 100 },
                              ];
                              setEditingDish({ ...editingDish, variants: updated });
                            }}
                            className="text-orange-600 hover:text-orange-700 cursor-pointer"
                          >
                            + Add Ingredient
                          </button>
                        </div>

                        {currVar.ingredients?.map((line, lIdx) => {
                          const ing = ingredientsMap.get(line.ingredientId);
                          const lineCost = ing ? line.quantity * ing.costPerBaseUnit : 0;

                          return (
                            <div key={lIdx} className="flex items-center gap-2 p-1.5 bg-white rounded-lg border border-neutral-200 text-xs">
                              <select
                                value={line.ingredientId}
                                onChange={(e) => {
                                  const updated = [...(editingDish.variants || [])];
                                  updated[activeDishVariantIndex].ingredients[lIdx].ingredientId = e.target.value;
                                  setEditingDish({ ...editingDish, variants: updated });
                                }}
                                className="flex-1 px-2 py-1 bg-neutral-50 border border-neutral-300 rounded text-xs"
                              >
                                {ingredients.map((i) => (
                                  <option key={i.id} value={i.id}>
                                    {i.name} (฿{formatMoney(i.costPerBaseUnit)}/{i.baseUnit})
                                  </option>
                                ))}
                              </select>

                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={line.quantity}
                                onChange={(e) => {
                                  const updated = [...(editingDish.variants || [])];
                                  updated[activeDishVariantIndex].ingredients[lIdx].quantity = parseFloat(e.target.value) || 0;
                                  setEditingDish({ ...editingDish, variants: updated });
                                }}
                                className="w-16 px-1.5 py-1 text-right bg-neutral-50 border border-neutral-300 rounded text-xs font-bold"
                              />

                              <span className="text-[10px] text-neutral-500 w-8">
                                {ing?.baseUnit || 'unit'}
                              </span>

                              <span className="w-14 text-right font-bold text-neutral-800">
                                ฿{formatMoney(lineCost)}
                              </span>

                              <button
                                type="button"
                                onClick={() => {
                                  const updated = [...(editingDish.variants || [])];
                                  updated[activeDishVariantIndex].ingredients.splice(lIdx, 1);
                                  setEditingDish({ ...editingDish, variants: updated });
                                }}
                                className="text-neutral-400 hover:text-rose-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Recipe Sub-Recipes List */}
                      {subRecipes.length > 0 && (
                        <div className="space-y-1.5 pt-2">
                          <div className="flex justify-between items-center text-[11px] font-bold text-neutral-700">
                            <span>Sub-Recipes</span>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...(editingDish.variants || [])];
                                const firstSub = subRecipes[0]?.id || '';
                                updated[activeDishVariantIndex].subRecipes = [
                                  ...(updated[activeDishVariantIndex].subRecipes || []),
                                  { subRecipeId: firstSub, quantity: 1 },
                                ];
                                setEditingDish({ ...editingDish, variants: updated });
                              }}
                              className="text-orange-600 hover:text-orange-700 cursor-pointer"
                            >
                              + Add Sub-Recipe
                            </button>
                          </div>

                          {currVar.subRecipes?.map((line, sIdx) => {
                            const sub = subRecipesMap.get(line.subRecipeId);
                            const subCalc = sub ? calculateSubRecipeCost(sub, ingredientsMap, subRecipesMap) : null;
                            const lineCost = subCalc ? line.quantity * subCalc.costPerOutputUnit : 0;

                            return (
                              <div key={sIdx} className="flex items-center gap-2 p-1.5 bg-white rounded-lg border border-neutral-200 text-xs">
                                <select
                                  value={line.subRecipeId}
                                  onChange={(e) => {
                                    const updated = [...(editingDish.variants || [])];
                                    updated[activeDishVariantIndex].subRecipes[sIdx].subRecipeId = e.target.value;
                                    setEditingDish({ ...editingDish, variants: updated });
                                  }}
                                  className="flex-1 px-2 py-1 bg-neutral-50 border border-neutral-300 rounded text-xs"
                                >
                                  {subRecipes.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>

                                <input
                                  type="number"
                                  min={0}
                                  step={0.1}
                                  value={line.quantity}
                                  onChange={(e) => {
                                    const updated = [...(editingDish.variants || [])];
                                    updated[activeDishVariantIndex].subRecipes[sIdx].quantity = parseFloat(e.target.value) || 0;
                                    setEditingDish({ ...editingDish, variants: updated });
                                  }}
                                  className="w-16 px-1.5 py-1 text-right bg-neutral-50 border border-neutral-300 rounded text-xs font-bold"
                                />

                                <span className="w-14 text-right font-bold text-neutral-800">
                                  ฿{formatMoney(lineCost)}
                                </span>

                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...(editingDish.variants || [])];
                                    updated[activeDishVariantIndex].subRecipes.splice(sIdx, 1);
                                    setEditingDish({ ...editingDish, variants: updated });
                                  }}
                                  className="text-neutral-400 hover:text-rose-600 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Attach Option Groups */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  {t.menuCost.attachedOptionGroups}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {optionGroups.map((grp) => {
                    const isAttached = (editingDish.optionGroupIds || []).includes(grp.id);
                    return (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => {
                          const curr = editingDish.optionGroupIds || [];
                          const next = isAttached
                            ? curr.filter((id) => id !== grp.id)
                            : [...curr, grp.id];
                          setEditingDish({ ...editingDish, optionGroupIds: next });
                        }}
                        className={`p-2 rounded-xl border text-xs font-semibold text-left cursor-pointer transition-colors ${
                          isAttached
                            ? 'bg-orange-500 text-white border-orange-600'
                            : 'bg-neutral-50 text-neutral-800 border-neutral-300 hover:bg-neutral-100'
                        }`}
                      >
                        {grp.name}
                      </button>
                    );
                  })}
                </div>
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
                  {t.menuCost.subRecipeName}
                </label>
                <input
                  type="text"
                  required
                  value={editingSubRecipe.name || ''}
                  onChange={(e) => setEditingSubRecipe({ ...editingSubRecipe, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. Tom Yum Broth Base"
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
                  {t.menuCost.packagingName}
                </label>
                <input
                  type="text"
                  required
                  value={editingPackaging.name || ''}
                  onChange={(e) => setEditingPackaging({ ...editingPackaging, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  placeholder="e.g. Bento Box, Drink Cup"
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
              if (!editingCategory.name) return;
              const isNew = !editingCategory.id;
              const catToSave: CategoryDoc = {
                id: editingCategory.id || `cat_${Date.now()}`,
                name: editingCategory.name,
                nameTh: editingCategory.nameTh || undefined,
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
                  {t.menuCost.categoryName} (English)
                </label>
                <input
                  type="text"
                  required
                  value={editingCategory.name || ''}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.common.nameTh}
                </label>
                <input
                  type="text"
                  value={editingCategory.nameTh || ''}
                  onChange={(e) => setEditingCategory({ ...editingCategory, nameTh: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
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
              if (!editingChannel.name) return;
              const isNew = !editingChannel.id;
              const chToSave: ChannelDoc = {
                id: editingChannel.id || `ch_${Date.now()}`,
                name: editingChannel.name,
                nameTh: editingChannel.nameTh || undefined,
                type: editingChannel.type || 'delivery',
                commissionPercent: editingChannel.commissionPercent || 0,
                packagingCost: editingChannel.packagingCost || 0,
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
                  {t.menuCost.channelName}
                </label>
                <input
                  type="text"
                  required
                  value={editingChannel.name || ''}
                  onChange={(e) => setEditingChannel({ ...editingChannel, name: e.target.value })}
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
    </div>
  );
};
