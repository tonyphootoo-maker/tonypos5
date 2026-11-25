import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  UtensilsCrossed,
  FlaskConical,
  Wheat,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Sparkles,
  SlidersHorizontal,
  Info,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Edit2,
  X,
  Package,
  Soup,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import {
  resolveCentralRecipeMenuTarget,
  isRiceNoodleRecipeItem,
  buildRecipeItemFromRiceNoodlePortion,
  computeRiceNoodleRecipeItemCost,
} from '../utils/centralRecipeNav';
import {
  MenuItem,
  Ingredient,
  Sauce,
  RecipeItem,
  SauceRecipeItem,
  RestaurantSettings,
  PackagingLineItem,
  UnitType,
  CentralBaseRecipe,
  RiceNoodlePortion,
} from '../types';
import { INITIAL_RICE_NOODLE_PORTIONS } from '../data/initialData';
import {
  calculateVariantCostBreakdown,
  calculateSauceCost,
} from '../services/calculationEngine';
import { convertUnit } from '../engine/units';
import {
  translateThaiToEnglish,
  computeAutoEnglishName,
  containsThaiCharacters,
  getLocalizedText,
  localizeUnit,
  learnShopTranslation,
} from '../../utils/thaiToEnglish';
import {
  useDebouncedTranslationScheduler,
  needsEnglishReview,
} from '../../hooks/useDebouncedThaiTranslation';
import { useLanguage } from '../../contexts/LanguageContext';
import { NumericInput } from './common/NumericInput';

// Presets for Packaging & Side Dishes in Central Recipe Repository
interface PresetItem {
  id: string;
  name: string;
  type: 'PACKAGING' | 'PREPARED_ITEM' | 'INGREDIENT';
  unit: UnitType;
  defaultQty: number;
  unitCost: number;
}

const PACKAGING_PRESETS: PresetItem[] = [
  { id: 'pkg_kraft_box', name: 'กล่องกระดาษคราฟท์อาหารรักษ์โลก', type: 'PACKAGING', unit: 'ชิ้น', defaultQty: 1, unitCost: 2.50 },
  { id: 'pkg_pp_box', name: 'กล่องพลาสติก PP ไมโครเวฟพร้อมฝา', type: 'PACKAGING', unit: 'ชิ้น', defaultQty: 1, unitCost: 3.50 },
  { id: 'pkg_cutlery_set', name: 'ชุดช้อนส้อมพลาสติก + ทิชชู', type: 'PACKAGING', unit: 'ชุด', defaultQty: 1, unitCost: 1.20 },
  { id: 'pkg_sauce_cup', name: 'ถ้วยน้ำจิ้ม 2oz + ฝา', type: 'PACKAGING', unit: 'ชิ้น', defaultQty: 1, unitCost: 0.80 },
  { id: 'pkg_bag', name: 'ถุงหูหิ้วพลาสติกรักษ์โลก', type: 'PACKAGING', unit: 'ชิ้น', defaultQty: 1, unitCost: 0.70 },
  { id: 'pkg_soup_bowl', name: 'ถ้วยซุปกระดาษ 350ml + ฝา', type: 'PACKAGING', unit: 'ชิ้น', defaultQty: 1, unitCost: 2.80 },
];

const SIDE_DISH_PRESETS: PresetItem[] = [
  { id: 'side_chili_fish_sauce', name: 'พริกน้ำปลาแท้ (ถ้วยแยก)', type: 'PREPARED_ITEM', unit: 'ชุด', defaultQty: 1, unitCost: 1.50 },
  { id: 'side_cucumber', name: 'แตงกวาหั่นชิ้นเคียง (30g)', type: 'PREPARED_ITEM', unit: 'ชุด', defaultQty: 1, unitCost: 1.00 },
  { id: 'side_lime', name: 'มะนาวฝานซีก', type: 'PREPARED_ITEM', unit: 'ชิ้น', defaultQty: 1, unitCost: 1.20 },
  { id: 'side_cooked_rice', name: 'ข้าวสวยหอมมะลิ (200g)', type: 'PREPARED_ITEM', unit: 'จาน', defaultQty: 1, unitCost: 8.67 },
  { id: 'side_fried_egg', name: 'ไข่ดาวเป็ด/ไก่', type: 'PREPARED_ITEM', unit: 'ฟอง', defaultQty: 1, unitCost: 7.00 },
  { id: 'side_fresh_herb', name: 'ผักเคียง / ต้นหอมผักชี', type: 'PREPARED_ITEM', unit: 'ชุด', defaultQty: 1, unitCost: 0.80 },
];

interface RecipeBuilderViewProps {
  menus: MenuItem[];
  ingredients: Ingredient[];
  sauces: Sauce[];
  baseRecipes?: CentralBaseRecipe[];
  riceNoodlePortions?: RiceNoodlePortion[];
  settings: RestaurantSettings;
  lang?: 'th' | 'en';
  initialVariantId?: string;
  initialMenuId?: string;
  targetNonce?: number;
  onTargetApplied?: () => void;
  returnOriginLabel?: string;
  onReturnToOrigin?: () => void;
  initialTab?: 'FOOD' | 'SAUCE' | 'RICE_NOODLES';
  onSaveVariantRecipe: (menuId: string, variantId: string, recipeItems: RecipeItem[]) => void;
  onSaveSauce?: (sauce: Sauce) => void;
  onSaveMenu?: (menu: MenuItem) => void;
  onSaveBaseRecipe?: (recipe: CentralBaseRecipe) => void;
  onDeleteBaseRecipe?: (recipeId: string) => void;
  onSaveRiceNoodlePortion?: (portion: RiceNoodlePortion) => void;
  onDeleteRiceNoodlePortion?: (portionId: string) => void;
}

export const RecipeBuilderView: React.FC<RecipeBuilderViewProps> = ({
  menus,
  ingredients,
  sauces,
  baseRecipes: propBaseRecipes,
  riceNoodlePortions: propRiceNoodlePortions,
  settings,
  lang: propLang,
  initialVariantId,
  initialMenuId,
  targetNonce,
  onTargetApplied,
  returnOriginLabel,
  onReturnToOrigin,
  initialTab,
  onSaveVariantRecipe,
  onSaveSauce,
  onSaveMenu,
  onSaveBaseRecipe,
  onDeleteBaseRecipe,
  onSaveRiceNoodlePortion,
  onDeleteRiceNoodlePortion,
}) => {
  void calculateVariantCostBreakdown;
  void onSaveVariantRecipe;
  void onSaveMenu;
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  // 3 Primary Tabs
  const [activeTab, setActiveTab] = useState<'FOOD' | 'SAUCE' | 'RICE_NOODLES'>(initialTab || 'FOOD');

  React.useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Fast maps
  const ingredientsMap = useMemo(
    () => new Map<string, Ingredient>(ingredients.map((i) => [i.id, i])),
    [ingredients]
  );
  const saucesMap = useMemo(
    () => new Map<string, Sauce>(sauces.map((s) => [s.id, s])),
    [sauces]
  );

  const [localFallbackPortions, setLocalFallbackPortions] = useState<RiceNoodlePortion[]>(
    () => INITIAL_RICE_NOODLE_PORTIONS
  );
  const portionRecipes = propRiceNoodlePortions ?? localFallbackPortions;
  const riceNoodlePortionsMap = useMemo(
    () => new Map<string, RiceNoodlePortion>(portionRecipes.map((p) => [p.id, p])),
    [portionRecipes]
  );

  // --- TAB 1: STANDALONE CENTRAL BASE RECIPES (คลังสูตรอาหารกลางที่สร้างโดยผู้ใช้) ---
  const [localFallbackBaseRecipes, setLocalFallbackBaseRecipes] = useState<CentralBaseRecipe[]>([]);
  const baseRecipes = propBaseRecipes ?? localFallbackBaseRecipes;

  const [selectedBaseRecipeId, setSelectedBaseRecipeId] = useState<string>(() => {
    const resolved = resolveCentralRecipeMenuTarget(menus, {
      variantId: initialVariantId,
      menuId: initialMenuId,
    });
    const linkedBaseId = resolved?.variant?.baseRecipeId;
    if (linkedBaseId && (propBaseRecipes || []).some((r) => r.id === linkedBaseId)) {
      return linkedBaseId;
    }
    return '';
  });

  const currentBaseRecipe = useMemo(() => {
    if (baseRecipes.length === 0 || !selectedBaseRecipeId) return null;
    return baseRecipes.find((r) => r.id === selectedBaseRecipeId) || null;
  }, [baseRecipes, selectedBaseRecipeId]);

  const [localBaseItems, setLocalBaseItems] = useState<RecipeItem[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const [showReturnUnsavedConfirm, setShowReturnUnsavedConfirm] = useState(false);
  const lastLoadedBaseRecipeIdRef = useRef<string>('');
  const appliedTargetKeyRef = useRef<string | null>(null);
  const onTargetAppliedRef = useRef(onTargetApplied);
  onTargetAppliedRef.current = onTargetApplied;

  // Create / Rename modal for standalone Central Base Recipe
  const [isBaseRecipeMetaModalOpen, setIsBaseRecipeMetaModalOpen] = useState(false);
  const [editingBaseRecipeMeta, setEditingBaseRecipeMeta] = useState<Partial<CentralBaseRecipe> | null>(null);
  const [baseRecipeRiceNoodleQty, setBaseRecipeRiceNoodleQty] = useState<number>(200);
  const [baseRecipeMetaError, setBaseRecipeMetaError] = useState<string | null>(null);
  const prevBaseRecipeThaiRef = useRef<string>('');
  const baseRecipeTranslationScheduler = useDebouncedTranslationScheduler(600);
  const [baseRecipeToDelete, setBaseRecipeToDelete] = useState<CentralBaseRecipe | null>(null);

  useEffect(() => {
    const navKey =
      initialVariantId || initialMenuId
        ? `${targetNonce ?? 0}:${initialVariantId ?? ''}:${initialMenuId ?? ''}`
        : null;
    if (!navKey) {
      appliedTargetKeyRef.current = null;
      return;
    }
    if (appliedTargetKeyRef.current === navKey) {
      return;
    }
    if (menus.length === 0) {
      return;
    }
    const resolved = resolveCentralRecipeMenuTarget(menus, {
      variantId: initialVariantId,
      menuId: initialMenuId,
    });
    if (resolved) {
      appliedTargetKeyRef.current = navKey;
      const linkedId = resolved.variant?.baseRecipeId;
      if (linkedId && baseRecipes.some((r) => r.id === linkedId)) {
        setSelectedBaseRecipeId(linkedId);
      }
      setActiveTab('FOOD');
      setShowReturnUnsavedConfirm(false);
      onTargetAppliedRef.current?.();
    }
  }, [initialVariantId, initialMenuId, targetNonce, menus, baseRecipes]);

  // Clear selection if the expanded card was deleted
  useEffect(() => {
    if (baseRecipes.length === 0) {
      if (selectedBaseRecipeId !== '') setSelectedBaseRecipeId('');
      if (lastLoadedBaseRecipeIdRef.current !== '') {
        lastLoadedBaseRecipeIdRef.current = '';
        setLocalBaseItems([]);
        setHasUnsavedChanges(false);
      }
      return;
    }
    if (selectedBaseRecipeId && !baseRecipes.some((r) => r.id === selectedBaseRecipeId)) {
      setSelectedBaseRecipeId('');
      lastLoadedBaseRecipeIdRef.current = '';
      setLocalBaseItems([]);
      setHasUnsavedChanges(false);
    }
  }, [baseRecipes, selectedBaseRecipeId]);

  // Load items whenever selected standalone CentralBaseRecipe changes
  useEffect(() => {
    if (!currentBaseRecipe) return;
    const isSwitchingRecipe = lastLoadedBaseRecipeIdRef.current !== currentBaseRecipe.id;
    if (!isSwitchingRecipe && hasUnsavedChanges) {
      return;
    }
    if (isSwitchingRecipe) {
      lastLoadedBaseRecipeIdRef.current = currentBaseRecipe.id;
    }
    const items = (currentBaseRecipe.items || []).map((it, idx) => ({
      ...it,
      id: it.id || `base_item_${idx}_${it.ingredientId || Date.now()}`,
    }));
    setLocalBaseItems(items);
    setHasUnsavedChanges(false);
  }, [currentBaseRecipe, hasUnsavedChanges]);

  // Calculate unit cost and line cost for each item with unit conversion
  const getItemCost = (item: RecipeItem) => {
    if (isRiceNoodleRecipeItem(item)) {
      const rn = computeRiceNoodleRecipeItemCost(item, riceNoodlePortionsMap);
      return {
        unitCost: rn.unitCost,
        lineCost: rn.lineCost,
        missingPrice: rn.missingPrice,
      };
    }

    if (item.type === 'SAUCE') {
      const sauce = saucesMap.get(item.ingredientId || item.sauceId || '');
      if (sauce) {
        const c = calculateSauceCost(sauce, ingredientsMap);
        const conv = convertUnit(item.quantity || 0, item.unit || sauce.productionUnit || 'g', sauce.productionUnit || 'g');
        const qty = conv.success ? conv.convertedQuantity : 0;
        return {
          unitCost: c.costPerGram,
          lineCost: c.isValid && conv.success ? qty * c.costPerGram : 0,
          missingPrice: !!c.hasMissingPrice || !!c.missingPrice || !c.isValid || !conv.success,
        };
      }
      return { unitCost: 0, lineCost: 0, missingPrice: true };
    }

    if (item.type === 'PACKAGING') {
      const preset = PACKAGING_PRESETS.find((p) => p.id === item.ingredientId || p.name === item.name);
      const ing = ingredientsMap.get(item.ingredientId);
      const unitCost = preset?.unitCost ?? (ing?.costPerBaseUnit ?? (item.calculatedUnitCost || 0));
      return { unitCost, lineCost: item.quantity * unitCost, missingPrice: unitCost <= 0 };
    }

    if (item.type === 'PREPARED_ITEM') {
      const preset = SIDE_DISH_PRESETS.find((p) => p.id === item.ingredientId || p.name === item.name);
      const ing = ingredientsMap.get(item.ingredientId);
      if (preset) {
        return { unitCost: preset.unitCost, lineCost: item.quantity * preset.unitCost, missingPrice: false };
      }
      if (ing) {
        const targetUnit = ing.usageUnit || ing.baseUnit || item.unit;
        const conv = convertUnit(item.quantity || 0, item.unit || targetUnit, targetUnit);
        const qty = conv.success ? conv.convertedQuantity : 0;
        return { unitCost: ing.costPerBaseUnit, lineCost: conv.success ? qty * ing.costPerBaseUnit : 0, missingPrice: !conv.success };
      }
      return { unitCost: 0, lineCost: 0, missingPrice: true };
    }

    const ing = ingredientsMap.get(item.ingredientId);
    if (!ing) {
      return { unitCost: 0, lineCost: 0, missingPrice: true };
    }
    const targetUnit = ing.usageUnit || ing.baseUnit || item.unit;
    const conv = convertUnit(item.quantity || 0, item.unit || targetUnit, targetUnit);
    const unitCost = ing.costPerBaseUnit;
    const missingPrice = !ing.purchasePrice || ing.purchasePrice <= 0 || !conv.success;
    return {
      unitCost,
      lineCost: conv.success ? conv.convertedQuantity * unitCost : 0,
      missingPrice,
    };
  };

  const totalSideDishCost = useMemo(() => {
    return localBaseItems
      .filter((it) => it.type === 'PREPARED_ITEM' || it.ingredientType === 'PREPARED_ITEM')
      .reduce((sum, it) => sum + getItemCost(it).lineCost, 0);
  }, [localBaseItems, ingredientsMap, saucesMap]);

  const totalPackagingCost = useMemo(() => {
    return localBaseItems
      .filter((it) => it.type === 'PACKAGING' || it.ingredientType === 'PACKAGING')
      .reduce((sum, it) => sum + getItemCost(it).lineCost, 0);
  }, [localBaseItems, ingredientsMap, saucesMap]);

  const nonPackagingItems = useMemo(() => {
    return localBaseItems.filter(
      (it) =>
        it.type !== 'PACKAGING' &&
        it.ingredientType !== 'PACKAGING' &&
        it.type !== 'PREPARED_ITEM' &&
        it.ingredientType !== 'PREPARED_ITEM'
    );
  }, [localBaseItems]);

  const packagingAndSideItems = useMemo(() => {
    return localBaseItems.filter(
      (it) =>
        it.type === 'PACKAGING' ||
        it.ingredientType === 'PACKAGING' ||
        it.type === 'PREPARED_ITEM' ||
        it.ingredientType === 'PREPARED_ITEM'
    );
  }, [localBaseItems]);

  const handleRemoveBaseItemById = (itemId: string) => {
    const updated = localBaseItems.filter((it) => it.id !== itemId);
    setLocalBaseItems(updated);
    setHasUnsavedChanges(true);
  };

  const handleUpdateBaseItemSourceById = (itemId: string, newSourceId: string) => {
    const updated = localBaseItems.map((current) => {
      if (current.id !== itemId) return current;
      const clone = { ...current };
      if (isRiceNoodleRecipeItem(clone)) {
        const portion = riceNoodlePortionsMap.get(newSourceId);
        if (portion) {
          return buildRecipeItemFromRiceNoodlePortion(portion, portion.portionGram, clone.id);
        }
      } else if (clone.type === 'SAUCE') {
        const s = saucesMap.get(newSourceId);
        if (s) {
          const cost = calculateSauceCost(s, ingredientsMap);
          clone.ingredientId = s.id;
          clone.sauceId = s.id;
          clone.name = s.name;
          clone.unit = 'g';
          clone.calculatedUnitCost = cost.costPerGram;
          clone.calculatedLineCost = clone.quantity * cost.costPerGram;
        }
      } else if (clone.type === 'PACKAGING' || clone.ingredientType === 'PACKAGING') {
        const preset = PACKAGING_PRESETS.find((p) => p.id === newSourceId);
        if (preset) {
          clone.ingredientId = preset.id;
          clone.name = preset.name;
          clone.unit = preset.unit;
          clone.calculatedUnitCost = preset.unitCost;
          clone.calculatedLineCost = clone.quantity * preset.unitCost;
        } else {
          const ing = ingredientsMap.get(newSourceId);
          if (ing) {
            clone.ingredientId = ing.id;
            clone.name = ing.name;
            clone.unit = ing.usageUnit;
            clone.calculatedUnitCost = ing.costPerBaseUnit;
            clone.calculatedLineCost = clone.quantity * ing.costPerBaseUnit;
          }
        }
      } else if (clone.type === 'PREPARED_ITEM') {
        const preset = SIDE_DISH_PRESETS.find((p) => p.id === newSourceId);
        if (preset) {
          clone.ingredientId = preset.id;
          clone.name = preset.name;
          clone.unit = preset.unit;
          clone.calculatedUnitCost = preset.unitCost;
          clone.calculatedLineCost = clone.quantity * preset.unitCost;
        } else {
          const ing = ingredientsMap.get(newSourceId);
          if (ing) {
            clone.ingredientId = ing.id;
            clone.name = ing.name;
            clone.unit = ing.usageUnit;
            clone.calculatedUnitCost = ing.costPerBaseUnit;
            clone.calculatedLineCost = clone.quantity * ing.costPerBaseUnit;
          }
        }
      } else {
        const ing = ingredientsMap.get(newSourceId);
        if (ing) {
          clone.ingredientId = ing.id;
          clone.name = ing.name;
          clone.unit = ing.usageUnit;
          clone.calculatedUnitCost = ing.costPerBaseUnit;
          clone.calculatedLineCost = clone.quantity * ing.costPerBaseUnit;
        }
      }
      return clone;
    });
    setLocalBaseItems(updated);
    setHasUnsavedChanges(true);
  };

  const handleUpdateBaseItemQuantityById = (itemId: string, qty: number) => {
    const updated = localBaseItems.map((it) => {
      if (it.id !== itemId) return it;
      const clone = { ...it, quantity: qty };
      const cost = getItemCost(clone);
      clone.calculatedLineCost = cost.lineCost;
      return clone;
    });
    setLocalBaseItems(updated);
    setHasUnsavedChanges(true);
  };

  // Category management for Base Recipe & Sauce items
  const uniqueCategories = useMemo(() => {
    const defaultOrder = [
      'เนื้อสัตว์และอาหารทะเล',
      'ผักและสมุนไพร',
      'เครื่องปรุงและซอส',
      'ข้าวและเส้น',
      'ไข่และเต้าหู้',
      'ของแห้งและเบ็ดเตล็ด',
      'บรรจุภัณฑ์',
    ];
    const set = new Set<string>();
    ingredients.forEach((ing) => {
      if (ing.category) set.add(ing.category);
    });
    const ordered: string[] = [];
    defaultOrder.forEach((cat) => {
      if (set.has(cat)) {
        ordered.push(cat);
        set.delete(cat);
      }
    });
    set.forEach((cat) => ordered.push(cat));
    return ordered;
  }, [ingredients]);

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case 'เนื้อสัตว์และอาหารทะเล':
        return '🥩';
      case 'ผักและสมุนไพร':
        return '🥬';
      case 'เครื่องปรุงและซอส':
        return '🧂';
      case 'ข้าวและเส้น':
        return '🍚';
      case 'ไข่และเต้าหู้':
        return '🥚';
      case 'บรรจุภัณฑ์':
        return '🥡';
      case 'ของแห้งและเบ็ดเตล็ด':
        return '📦';
      default:
        return '📁';
    }
  };

  // Only seasonings and sauces category for Sauce modal (เครื่องปรุงและซอส)
  const seasoningIngredients = useMemo(() => {
    const list = ingredients.filter((i) => i.category === 'เครื่องปรุงและซอส');
    return list.length > 0 ? list : ingredients;
  }, [ingredients]);

  // State for category overrides in base recipe items and sauce items
  const [baseItemCategoryOverrides, setBaseItemCategoryOverrides] = useState<Record<string, string>>({});
  const [sauceItemCategoryOverrides, setSauceItemCategoryOverrides] = useState<Record<number, string>>({});

  // Modal for adding an ingredient to Base Recipe with 2-step selection
  const [isAddBaseIngModalOpen, setIsAddBaseIngModalOpen] = useState(false);
  const [newBaseIngCategory, setNewBaseIngCategory] = useState<string>('ผักและสมุนไพร');
  const [newBaseIngId, setNewBaseIngId] = useState<string>('');
  const [newBaseIngQty, setNewBaseIngQty] = useState<number>(10);

  const handleOpenAddBaseIngModal = () => {
    const candidate =
      ingredients.find(
        (i) =>
          !i.name.includes('หมู') &&
          !i.name.includes('ไก่') &&
          !i.name.includes('เนื้อ') &&
          !i.name.includes('กุ้ง') &&
          !i.name.includes('หมึก') &&
          i.category !== 'บรรจุภัณฑ์'
      ) || ingredients[0];

    const defaultCat = candidate?.category || 'ผักและสมุนไพร';
    const firstInCat = ingredients.find((i) => i.category === defaultCat) || candidate || ingredients[0];
    setNewBaseIngCategory(defaultCat);
    setNewBaseIngId(firstInCat?.id || '');
    setNewBaseIngQty(firstInCat?.usageUnit === 'g' ? 10 : 1);
    setIsAddBaseIngModalOpen(true);
  };

  const handleConfirmAddBaseIngredient = (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = ingredientsMap.get(newBaseIngId) || ingredients[0];
    if (!candidate) return;
    const newItem: RecipeItem = {
      id: `base_ing_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'INGREDIENT',
      ingredientType: 'INGREDIENT',
      ingredientId: candidate.id,
      name: candidate.name,
      quantity: newBaseIngQty > 0 ? newBaseIngQty : (candidate.usageUnit === 'g' ? 10 : 1),
      unit: candidate.usageUnit,
      calculatedUnitCost: candidate.costPerBaseUnit,
      calculatedLineCost: (newBaseIngQty > 0 ? newBaseIngQty : (candidate.usageUnit === 'g' ? 10 : 1)) * candidate.costPerBaseUnit,
    };
    setLocalBaseItems([...localBaseItems, newItem]);
    if (candidate.category && newItem.id) {
      setBaseItemCategoryOverrides((prev) => ({ ...prev, [newItem.id!]: candidate.category! }));
    }
    setHasUnsavedChanges(true);
    setIsAddBaseIngModalOpen(false);
  };

  const handleAddBaseIngredient = () => {
    handleOpenAddBaseIngModal();
  };

  const handleAddSauce = () => {
    const firstSauce = sauces[0];
    if (!firstSauce) return;
    const costInfo = calculateSauceCost(firstSauce, ingredientsMap);
    const newItem: RecipeItem = {
      id: `base_sauce_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'SAUCE',
      ingredientType: 'SAUCE',
      ingredientId: firstSauce.id,
      sauceId: firstSauce.id,
      name: firstSauce.name,
      quantity: 30,
      unit: 'g',
      calculatedUnitCost: costInfo.costPerGram,
      calculatedLineCost: 30 * costInfo.costPerGram,
    };
    setLocalBaseItems([...localBaseItems, newItem]);
    setHasUnsavedChanges(true);
  };

  // Modal for adding Rice & Noodles (Yield & Portions) item to Base Recipe
  const [isAddRiceNoodleModalOpen, setIsAddRiceNoodleModalOpen] = useState(false);
  const [newRiceNoodlePortionId, setNewRiceNoodlePortionId] = useState<string>('');
  const [newRiceNoodleQty, setNewRiceNoodleQty] = useState<number>(200);

  const handleOpenAddRiceNoodleModal = () => {
    const activePortions = portionRecipes.filter((p) => p.active !== false);
    const first = activePortions[0] || portionRecipes[0];
    setNewRiceNoodlePortionId(first?.id || '');
    setNewRiceNoodleQty(first?.portionGram || 150);
    setIsAddRiceNoodleModalOpen(true);
  };

  const handleConfirmAddRiceNoodle = (e: React.FormEvent) => {
    e.preventDefault();
    const portion = riceNoodlePortionsMap.get(newRiceNoodlePortionId) || portionRecipes[0];
    if (!portion) return;
    const newItem = buildRecipeItemFromRiceNoodlePortion(
      portion,
      newRiceNoodleQty > 0 ? newRiceNoodleQty : portion.portionGram
    );
    setLocalBaseItems([...localBaseItems, newItem]);
    setHasUnsavedChanges(true);
    setIsAddRiceNoodleModalOpen(false);
  };

  const handleAddSideDish = () => {
    const defaultSide = SIDE_DISH_PRESETS[0];
    const newItem: RecipeItem = {
      id: `base_side_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'PREPARED_ITEM',
      ingredientType: 'PREPARED_ITEM',
      ingredientId: defaultSide.id,
      name: defaultSide.name,
      quantity: defaultSide.defaultQty,
      unit: defaultSide.unit,
      calculatedUnitCost: defaultSide.unitCost,
      calculatedLineCost: defaultSide.defaultQty * defaultSide.unitCost,
    };
    setLocalBaseItems([...localBaseItems, newItem]);
    setHasUnsavedChanges(true);
  };

  const handleAddPackaging = () => {
    const defaultPkg = PACKAGING_PRESETS[0];
    const newItem: RecipeItem = {
      id: `base_pkg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'PACKAGING',
      ingredientType: 'PACKAGING',
      ingredientId: defaultPkg.id,
      name: defaultPkg.name,
      quantity: defaultPkg.defaultQty,
      unit: defaultPkg.unit,
      calculatedUnitCost: defaultPkg.unitCost,
      calculatedLineCost: defaultPkg.defaultQty * defaultPkg.unitCost,
    };
    setLocalBaseItems([...localBaseItems, newItem]);
    setHasUnsavedChanges(true);
  };

  const handleRemoveBaseItem = (index: number) => {
    const updated = [...localBaseItems];
    updated.splice(index, 1);
    setLocalBaseItems(updated);
    setHasUnsavedChanges(true);
  };

  const handleUpdateBaseItemSource = (index: number, id: string) => {
    const updated = [...localBaseItems];
    const current = updated[index];
    if (current.type === 'SAUCE') {
      const s = saucesMap.get(id);
      if (s) {
        const cost = calculateSauceCost(s, ingredientsMap);
        current.ingredientId = s.id;
        current.sauceId = s.id;
        current.name = s.name;
        current.unit = 'g';
        current.calculatedUnitCost = cost.costPerGram;
        current.calculatedLineCost = current.quantity * cost.costPerGram;
      }
    } else if (current.type === 'PACKAGING') {
      const preset = PACKAGING_PRESETS.find((p) => p.id === id);
      if (preset) {
        current.ingredientId = preset.id;
        current.name = preset.name;
        current.unit = preset.unit;
        current.calculatedUnitCost = preset.unitCost;
        current.calculatedLineCost = current.quantity * preset.unitCost;
      } else {
        const ing = ingredientsMap.get(id);
        if (ing) {
          current.ingredientId = ing.id;
          current.name = ing.name;
          current.unit = ing.usageUnit;
          current.calculatedUnitCost = ing.costPerBaseUnit;
          current.calculatedLineCost = current.quantity * ing.costPerBaseUnit;
        }
      }
    } else if (current.type === 'PREPARED_ITEM') {
      const preset = SIDE_DISH_PRESETS.find((p) => p.id === id);
      if (preset) {
        current.ingredientId = preset.id;
        current.name = preset.name;
        current.unit = preset.unit;
        current.calculatedUnitCost = preset.unitCost;
        current.calculatedLineCost = current.quantity * preset.unitCost;
      } else {
        const ing = ingredientsMap.get(id);
        if (ing) {
          current.ingredientId = ing.id;
          current.name = ing.name;
          current.unit = ing.usageUnit;
          current.calculatedUnitCost = ing.costPerBaseUnit;
          current.calculatedLineCost = current.quantity * ing.costPerBaseUnit;
        }
      }
    } else {
      const ing = ingredientsMap.get(id);
      if (ing) {
        current.ingredientId = ing.id;
        current.name = ing.name;
        current.unit = ing.usageUnit;
        current.calculatedUnitCost = ing.costPerBaseUnit;
        current.calculatedLineCost = current.quantity * ing.costPerBaseUnit;
      }
    }
    setLocalBaseItems(updated);
    setHasUnsavedChanges(true);
  };

  const handleUpdateBaseItemQuantity = (index: number, qty: number) => {
    const updated = [...localBaseItems];
    updated[index].quantity = qty;
    const cost = getItemCost(updated[index]);
    updated[index].calculatedLineCost = cost.lineCost;
    setLocalBaseItems(updated);
    setHasUnsavedChanges(true);
  };

  const handleOpenCreateBaseRecipe = () => {
    baseRecipeTranslationScheduler.cancelAll();
    prevBaseRecipeThaiRef.current = '';
    setBaseRecipeMetaError(null);
    setBaseRecipeRiceNoodleQty(200);
    setEditingBaseRecipeMeta({
      id: `base_recipe_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      thaiName: '',
      englishName: '',
      englishNameManual: false,
      description: '',
      riceNoodlePortionId: '',
      items: [],
      active: true,
      displayOrder: baseRecipes.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setIsBaseRecipeMetaModalOpen(true);
  };

  const handleOpenEditBaseRecipeMeta = (recipe: CentralBaseRecipe) => {
    baseRecipeTranslationScheduler.cancelAll();
    setBaseRecipeMetaError(null);
    const thName = recipe.thaiName || recipe.name || '';
    prevBaseRecipeThaiRef.current = thName;
    const storedEn = (recipe.englishName || '').trim();
    const isManual = Boolean(recipe.englishNameManual);
    const effectiveItems =
      currentBaseRecipe?.id === recipe.id && hasUnsavedChanges ? localBaseItems : recipe.items || [];
    const linkedRnItem = effectiveItems.find((it) => isRiceNoodleRecipeItem(it));
    const linkedRnId = recipe.riceNoodlePortionId || linkedRnItem?.riceNoodlePortionId || '';
    const linkedPortion = linkedRnId ? riceNoodlePortionsMap.get(linkedRnId) : undefined;
    setBaseRecipeRiceNoodleQty(
      Number(linkedRnItem?.quantity) > 0
        ? Number(linkedRnItem?.quantity)
        : linkedPortion?.portionGram || 200
    );
    setEditingBaseRecipeMeta({
      ...recipe,
      name: thName,
      thaiName: thName,
      englishName:
        isManual && storedEn && !containsThaiCharacters(storedEn)
          ? storedEn
          : storedEn && !containsThaiCharacters(storedEn)
          ? storedEn
          : translateThaiToEnglish(thName),
      englishNameManual: isManual,
      riceNoodlePortionId: linkedRnId,
    });
    setIsBaseRecipeMetaModalOpen(true);
  };

  const handleSaveBaseRecipeMetaModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBaseRecipeMeta) return;
    const trimmedTh = (editingBaseRecipeMeta.name || '').trim();
    if (!trimmedTh) {
      setBaseRecipeMetaError(
        lang === 'en' ? 'Please enter a base recipe name.' : 'กรุณาระบุชื่อสูตรอาหารกลาง'
      );
      return;
    }
    baseRecipeTranslationScheduler.cancelAll();
    const isManual = Boolean(editingBaseRecipeMeta.englishNameManual);
    const trimmedEn = isManual
      ? (editingBaseRecipeMeta.englishName || '').trim()
      : computeAutoEnglishName({
          previousThai: prevBaseRecipeThaiRef.current || trimmedTh,
          nextThai: trimmedTh,
          currentEnglish: editingBaseRecipeMeta.englishName || '',
          isManuallyEdited: false,
        }).trim() || translateThaiToEnglish(trimmedTh);

    const existing = baseRecipes.find((r) => r.id === editingBaseRecipeMeta.id);
    let currentItems = [
      ...(existing && currentBaseRecipe?.id === existing.id && hasUnsavedChanges
        ? localBaseItems
        : existing?.items || editingBaseRecipeMeta.items || []),
    ];

    const selectedRnId = (editingBaseRecipeMeta.riceNoodlePortionId || '').trim();
    const selectedPortion = selectedRnId ? riceNoodlePortionsMap.get(selectedRnId) : undefined;
    const existingRnIndex = currentItems.findIndex((it) => isRiceNoodleRecipeItem(it));

    if (selectedPortion) {
      const targetQty =
        baseRecipeRiceNoodleQty > 0 ? baseRecipeRiceNoodleQty : selectedPortion.portionGram;
      const newRnItem = buildRecipeItemFromRiceNoodlePortion(
        selectedPortion,
        targetQty,
        existingRnIndex >= 0 ? currentItems[existingRnIndex].id : undefined
      );
      if (existingRnIndex >= 0) {
        currentItems[existingRnIndex] = newRnItem;
      } else {
        currentItems.push(newRnItem);
      }
    } else if (existingRnIndex >= 0) {
      currentItems = currentItems.filter((it) => !isRiceNoodleRecipeItem(it));
    }

    const recipeId =
      editingBaseRecipeMeta.id ||
      `base_recipe_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const finalRecipe: CentralBaseRecipe = {
      id: recipeId,
      name: trimmedTh,
      thaiName: trimmedTh,
      englishName: trimmedEn,
      englishNameManual: isManual,
      description: editingBaseRecipeMeta.description?.trim() || undefined,
      riceNoodlePortionId: selectedPortion?.id || undefined,
      items: currentItems,
      packagingCost: existing?.packagingCost ?? editingBaseRecipeMeta.packagingCost ?? 0,
      packagingItems: existing?.packagingItems ?? editingBaseRecipeMeta.packagingItems ?? [],
      active: editingBaseRecipeMeta.active !== false,
      displayOrder: editingBaseRecipeMeta.displayOrder ?? baseRecipes.length + 1,
      createdAt: existing?.createdAt || editingBaseRecipeMeta.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (onSaveBaseRecipe) {
      onSaveBaseRecipe(finalRecipe);
    } else {
      setLocalFallbackBaseRecipes((prev) =>
        prev.some((r) => r.id === finalRecipe.id)
          ? prev.map((r) => (r.id === finalRecipe.id ? finalRecipe : r))
          : [...prev, finalRecipe]
      );
    }
    if (trimmedTh && trimmedEn) {
      learnShopTranslation(trimmedTh, trimmedEn, { isManual });
    }
    if (!existing || selectedBaseRecipeId === finalRecipe.id) {
      setSelectedBaseRecipeId(finalRecipe.id);
      lastLoadedBaseRecipeIdRef.current = finalRecipe.id;
      setLocalBaseItems(finalRecipe.items || []);
      setHasUnsavedChanges(false);
    }
    setBaseRecipeMetaError(null);
    setIsBaseRecipeMetaModalOpen(false);
  };

  const handleConfirmDeleteBaseRecipe = () => {
    if (!baseRecipeToDelete) return;
    const targetId = baseRecipeToDelete.id;
    if (onDeleteBaseRecipe) {
      onDeleteBaseRecipe(targetId);
    } else {
      setLocalFallbackBaseRecipes((prev) => prev.filter((r) => r.id !== targetId));
    }
    setBaseRecipeToDelete(null);
  };

  const handleSelectBaseRecipeCard = (recipe: CentralBaseRecipe) => {
    if (selectedBaseRecipeId === recipe.id) {
      setSelectedBaseRecipeId('');
      lastLoadedBaseRecipeIdRef.current = '';
      setLocalBaseItems([]);
      setHasUnsavedChanges(false);
      return;
    }
    setSelectedBaseRecipeId(recipe.id);
    lastLoadedBaseRecipeIdRef.current = recipe.id;
    setLocalBaseItems(
      (recipe.items || []).map((it, idx) => ({
        ...it,
        id: it.id || `base_item_${idx}_${it.ingredientId || Date.now()}`,
      }))
    );
    setHasUnsavedChanges(false);
  };

  const handleSaveBaseRecipe = () => {
    if (!currentBaseRecipe) return;

    const packagingCost = totalPackagingCost;
    const packagingItems: PackagingLineItem[] = localBaseItems
      .filter((it) => it.type === 'PACKAGING' || it.ingredientType === 'PACKAGING')
      .map((it) => ({
        id: it.id || `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: it.name,
        cost: getItemCost(it).lineCost,
      }));

    const enrichedBaseItems = localBaseItems.map((it) => {
      const c = getItemCost(it);
      return {
        ...it,
        calculatedUnitCost: c.unitCost,
        calculatedLineCost: c.lineCost,
      };
    });

    const firstLinkedRn = enrichedBaseItems.find((it) => isRiceNoodleRecipeItem(it));

    const updatedRecipe: CentralBaseRecipe = {
      ...currentBaseRecipe,
      riceNoodlePortionId: firstLinkedRn?.riceNoodlePortionId || undefined,
      items: enrichedBaseItems,
      packagingCost,
      packagingItems,
      updatedAt: new Date().toISOString(),
    };

    if (onSaveBaseRecipe) {
      onSaveBaseRecipe(updatedRecipe);
    } else {
      setLocalFallbackBaseRecipes((prev) =>
        prev.map((r) => (r.id === updatedRecipe.id ? updatedRecipe : r))
      );
    }

    setLocalBaseItems(enrichedBaseItems);
    setHasUnsavedChanges(false);
    setSaveSuccessNotice(true);
    setTimeout(() => setSaveSuccessNotice(false), 3500);
  };

  // --- TAB 2: MAIN SAUCES (ซอสหลัก) ---
  const [selectedSauce, setSelectedSauce] = useState<Sauce | null>(sauces[0] || null);
  const [isSauceModalOpen, setIsSauceModalOpen] = useState(false);
  const [editingSauce, setEditingSauce] = useState<Partial<Sauce> | null>(null);
  const [sauceFormError, setSauceFormError] = useState<string | null>(null);
  const prevSauceThaiRef = useRef<string>('');
  const sauceTranslationScheduler = useDebouncedTranslationScheduler(600);

  const handleOpenAddSauce = () => {
    sauceTranslationScheduler.cancelAll();
    prevSauceThaiRef.current = '';
    const newSauce: Partial<Sauce> = {
      id: `sauce_${Date.now()}`,
      name: '',
      thaiName: '',
      englishName: '',
      englishNameManual: false,
      category: 'ซอสปรุงรส',
      productionQuantity: 1000,
      productionUnit: 'g',
      yieldPercent: 100,
      actualQuantity: 1000,
      productionCost: 0,
      actualCost: 0,
      costPerGram: 0,
      items: [],
      active: true,
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSauceFormError(null);
    setEditingSauce(newSauce);
    setIsSauceModalOpen(true);
  };

  const handleOpenEditSauce = (sauce: Sauce) => {
    sauceTranslationScheduler.cancelAll();
    setSauceFormError(null);
    const cloned = JSON.parse(JSON.stringify(sauce));
    const thName = cloned.thaiName || cloned.name || '';
    prevSauceThaiRef.current = thName;
    const storedEn = (cloned.englishName || '').trim();
    cloned.thaiName = thName;
    cloned.englishNameManual = Boolean(cloned.englishNameManual);
    cloned.englishName =
      cloned.englishNameManual && storedEn && !containsThaiCharacters(storedEn)
        ? storedEn
        : storedEn && !containsThaiCharacters(storedEn)
        ? storedEn
        : translateThaiToEnglish(thName);
    setEditingSauce(cloned);
    setIsSauceModalOpen(true);
  };

  const handleSaveSauceModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSauce || !editingSauce.name?.trim()) {
      setSauceFormError(lang === 'en' ? 'Please enter a sauce recipe name' : 'กรุณาระบุชื่อสูตรซอส');
      return;
    }
    sauceTranslationScheduler.cancelAll();

    const rawActual = Number(editingSauce.actualQuantity);
    if (!Number.isFinite(rawActual) || rawActual <= 0) {
      setSauceFormError(lang === 'en' ? 'Please enter the actual yield quantity' : 'กรุณาระบุปริมาณสุทธิของซอส');
      return;
    }

    const calc = calculateSauceCost(editingSauce, ingredientsMap);
    if (!calc.isValid) {
      setSauceFormError(
        (calc.errorMessage ? getLocalizedText(lang, calc.errorMessage) : '') ||
          (lang === 'en' ? 'Sauce recipe data is incomplete or invalid' : 'ข้อมูลสูตรซอสยังไม่ถูกต้อง')
      );
      return;
    }

    const trimmedTh = editingSauce.name.trim();
    const isManual = Boolean(editingSauce.englishNameManual);
    const trimmedEn = isManual
      ? (editingSauce.englishName || '').trim()
      : computeAutoEnglishName({
          previousThai: prevSauceThaiRef.current || trimmedTh,
          nextThai: trimmedTh,
          currentEnglish: editingSauce.englishName || '',
          isManuallyEdited: false,
        }).trim() || translateThaiToEnglish(trimmedTh);

    const finalSauce: Sauce = {
      id: editingSauce.id || `sauce_${Date.now()}`,
      name: trimmedTh,
      thaiName: trimmedTh,
      englishName: trimmedEn,
      englishNameManual: isManual,
      category: editingSauce.category || 'ซอสปรุงรส',
      productionQuantity: Number(editingSauce.productionQuantity) || rawActual,
      productionUnit: editingSauce.productionUnit || 'g',
      yieldPercent: Number(editingSauce.yieldPercent) > 0 ? Number(editingSauce.yieldPercent) : 100,
      actualQuantity: rawActual,
      productionCost: calc.productionCost,
      actualCost: calc.actualCost,
      costPerGram: calc.costPerGram,
      items: editingSauce.items || [],
      active: editingSauce.active !== undefined ? editingSauce.active : true,
      notes: editingSauce.notes,
      createdAt: editingSauce.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (onSaveSauce) {
      onSaveSauce(finalSauce);
    }
    if (trimmedTh && trimmedEn) {
      learnShopTranslation(trimmedTh, trimmedEn, { isManual });
    }
    setSauceFormError(null);
    setSelectedSauce(finalSauce);
    setIsSauceModalOpen(false);
  };

  // --- TAB 3: RICE & NOODLES (ข้าวและเส้น) ---
  const riceAndNoodleIngredients = useMemo(() => {
    return ingredients.filter(
      (ing) =>
        ing.category === 'ข้าวและเส้น' ||
        ing.name.includes('ข้าว') ||
        ing.name.includes('เส้น') ||
        ing.name.includes('มาม่า') ||
        ing.name.includes('วุ้นเส้น')
    );
  }, [ingredients]);

  const [isPortionModalOpen, setIsPortionModalOpen] = useState(false);
  const [editingPortion, setEditingPortion] = useState<Partial<RiceNoodlePortion> | null>(null);
  const [portionFormError, setPortionFormError] = useState<string | null>(null);
  const [portionToDelete, setPortionToDelete] = useState<RiceNoodlePortion | null>(null);
  const prevPortionThaiRef = useRef<string>('');
  const portionTranslationScheduler = useDebouncedTranslationScheduler(600);

  const handleOpenAddPortion = () => {
    portionTranslationScheduler.cancelAll();
    prevPortionThaiRef.current = '';
    setPortionFormError(null);
    setEditingPortion({
      id: `portion_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      nameEn: '',
      type: 'ข้าว',
      typeEn: 'Rice',
      linkedIngredientId: '',
      rawIngredientName: '',
      rawIngredientNameEn: '',
      rawPurchaseCost: '',
      rawPurchaseCostEn: '',
      cookingYield: '100%',
      cookingYieldEn: '100%',
      yieldPercent: 100,
      portionGram: 150,
      costPerPortion: 0,
      dishesUsing: [],
      dishesUsingEn: [],
      active: true,
    });
    setIsPortionModalOpen(true);
  };

  const handleOpenEditPortion = (portion: RiceNoodlePortion) => {
    portionTranslationScheduler.cancelAll();
    setPortionFormError(null);
    const cloned: Partial<RiceNoodlePortion> = JSON.parse(JSON.stringify(portion));
    prevPortionThaiRef.current = cloned.name || '';
    if (!cloned.nameEn || containsThaiCharacters(cloned.nameEn)) {
      cloned.nameEn = translateThaiToEnglish(cloned.name || '');
    }
    setEditingPortion(cloned);
    setIsPortionModalOpen(true);
  };

  const handleLinkIngredientToPortion = (ingredientId: string) => {
    setPortionFormError(null);
    setEditingPortion((prev) => {
      if (!prev) return prev;
      if (!ingredientId) {
        return { ...prev, linkedIngredientId: '' };
      }
      const ing = ingredientsMap.get(ingredientId);
      if (!ing) {
        return { ...prev, linkedIngredientId: ingredientId };
      }
      const gram = Number(prev.portionGram) > 0 ? Number(prev.portionGram) : 150;
      const conv = convertUnit(gram, 'g', ing.usageUnit || ing.baseUnit || 'g');
      const effQty = conv.success ? conv.convertedQuantity : gram;
      const computedCost = Number(((ing.costPerBaseUnit || 0) * effQty).toFixed(2));
      const yieldVal = Number(ing.yieldPercent) > 0 ? Number(ing.yieldPercent) : 100;
      const priceLabel =
        ing.purchasePrice && ing.purchaseQuantity
          ? `฿${ing.purchasePrice} / ${ing.purchaseQuantity}${ing.purchaseUnit || 'g'}`
          : prev.rawPurchaseCost || '';
      const rawNameTh = ing.thaiName || ing.name;
      const rawNameEn = ing.englishName || translateThaiToEnglish(rawNameTh);
      const nextNameTh = prev.name?.trim() ? prev.name : `${rawNameTh} (${gram}g)`;
      const nextNameEn =
        prev.nameEn?.trim() && !containsThaiCharacters(prev.nameEn)
          ? prev.nameEn
          : `${rawNameEn} (${gram}g)`;
      prevPortionThaiRef.current = nextNameTh;

      return {
        ...prev,
        linkedIngredientId: ing.id,
        name: nextNameTh,
        nameEn: nextNameEn,
        rawIngredientName: rawNameTh,
        rawIngredientNameEn: rawNameEn,
        rawPurchaseCost: priceLabel,
        rawPurchaseCostEn: priceLabel,
        yieldPercent: yieldVal,
        cookingYield: `${yieldVal}%`,
        cookingYieldEn: `${yieldVal}%`,
        portionGram: gram,
        costPerPortion: computedCost,
      };
    });
  };

  const handleSavePortionModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPortion || !editingPortion.name?.trim()) {
      setPortionFormError(lang === 'en' ? 'Please enter a recipe name' : 'กรุณาระบุชื่อสูตรข้าว/เส้น');
      return;
    }
    const portionGram = Number(editingPortion.portionGram);
    if (!Number.isFinite(portionGram) || portionGram <= 0) {
      setPortionFormError(
        lang === 'en' ? 'Serving size must be greater than 0' : 'ขนาดเสิร์ฟต้องมากกว่า 0 กรัม'
      );
      return;
    }
    const costPerPortion = Number(editingPortion.costPerPortion);
    if (!Number.isFinite(costPerPortion) || costPerPortion < 0) {
      setPortionFormError(
        lang === 'en' ? 'Cost per dish cannot be negative' : 'ต้นทุนต่อจานต้องไม่ติดลบ'
      );
      return;
    }

    portionTranslationScheduler.cancelAll();
    const trimmedTh = editingPortion.name.trim();
    const trimmedEn =
      (editingPortion.nameEn || '').trim() && !containsThaiCharacters(editingPortion.nameEn || '')
        ? (editingPortion.nameEn || '').trim()
        : computeAutoEnglishName({
            previousThai: prevPortionThaiRef.current || trimmedTh,
            nextThai: trimmedTh,
            currentEnglish: editingPortion.nameEn || '',
            isManuallyEdited: false,
          }).trim() || translateThaiToEnglish(trimmedTh);

    const typeTh = (editingPortion.type || 'ข้าว').trim();
    const typeEn =
      editingPortion.typeEn?.trim() ||
      (typeTh === 'ข้าว' ? 'Rice' : typeTh === 'เส้น' ? 'Noodles' : translateThaiToEnglish(typeTh));
    const rawIngTh = (editingPortion.rawIngredientName || '').trim() || trimmedTh;
    const rawIngEn =
      (editingPortion.rawIngredientNameEn || '').trim() || translateThaiToEnglish(rawIngTh);
    const yieldMatch = (editingPortion.cookingYield || '').match(/(\d+(?:\.\d+)?)/);
    const parsedYield =
      Number(editingPortion.yieldPercent) > 0
        ? Number(editingPortion.yieldPercent)
        : yieldMatch
        ? parseFloat(yieldMatch[1])
        : 100;

    const dishesTh = (editingPortion.dishesUsing || []).map((d) => d.trim()).filter(Boolean);
    const dishesEn =
      (editingPortion.dishesUsingEn || []).length === dishesTh.length &&
      (editingPortion.dishesUsingEn || []).every((d) => !containsThaiCharacters(d))
        ? (editingPortion.dishesUsingEn || [])
        : dishesTh.map((d) => translateThaiToEnglish(d));

    const now = new Date().toISOString();
    const finalPortion: RiceNoodlePortion = {
      id:
        editingPortion.id ||
        `portion_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: trimmedTh,
      nameEn: trimmedEn,
      type: typeTh,
      typeEn,
      linkedIngredientId: editingPortion.linkedIngredientId || undefined,
      rawIngredientName: rawIngTh,
      rawIngredientNameEn: rawIngEn,
      rawPurchaseCost: (editingPortion.rawPurchaseCost || '').trim() || '-',
      rawPurchaseCostEn:
        (editingPortion.rawPurchaseCostEn || '').trim() ||
        (editingPortion.rawPurchaseCost || '').trim() ||
        '-',
      cookingYield: (editingPortion.cookingYield || '').trim() || `${parsedYield}%`,
      cookingYieldEn:
        (editingPortion.cookingYieldEn || '').trim() ||
        (editingPortion.cookingYield || '').trim() ||
        `${parsedYield}%`,
      yieldPercent: parsedYield,
      portionGram,
      costPerPortion: Number(costPerPortion.toFixed(2)),
      dishesUsing: dishesTh,
      dishesUsingEn: dishesEn,
      active: editingPortion.active !== false,
      createdAt: editingPortion.createdAt || now,
      updatedAt: now,
    };

    if (onSaveRiceNoodlePortion) {
      onSaveRiceNoodlePortion(finalPortion);
    } else {
      setLocalFallbackPortions((prev) =>
        prev.some((p) => p.id === finalPortion.id)
          ? prev.map((p) => (p.id === finalPortion.id ? finalPortion : p))
          : [...prev, finalPortion]
      );
    }
    if (trimmedTh && trimmedEn) {
      learnShopTranslation(trimmedTh, trimmedEn, { isManual: Boolean(editingPortion.nameEn?.trim()) });
    }
    setPortionFormError(null);
    setIsPortionModalOpen(false);
    setEditingPortion(null);
  };

  const handleConfirmDeletePortion = () => {
    if (!portionToDelete) return;
    const targetId = portionToDelete.id;
    if (onDeleteRiceNoodlePortion) {
      onDeleteRiceNoodlePortion(targetId);
    } else {
      setLocalFallbackPortions((prev) => prev.filter((p) => p.id !== targetId));
    }
    setPortionToDelete(null);
  };


  return (
    <div className="space-y-5 pb-8">
      {/* Header with 3 Tabs */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-3xl flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            {returnOriginLabel && onReturnToOrigin && (
              <button
                type="button"
                onClick={() => {
                  if (hasUnsavedChanges) {
                    setShowReturnUnsavedConfirm(true);
                  } else {
                    onReturnToOrigin();
                  }
                }}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white hover:bg-orange-50 text-stone-800 border border-[#D6CEBE] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                title={
                  lang === 'en'
                    ? `Back to ${returnOriginLabel}`
                    : `กลับไปที่${returnOriginLabel}`
                }
                aria-label={
                  lang === 'en'
                    ? `Back to ${returnOriginLabel}`
                    : `กลับไปที่${returnOriginLabel}`
                }
              >
                <ArrowLeft className="w-3.5 h-3.5 text-[#F27D26] shrink-0" />
                <span>
                  {lang === 'en'
                    ? `Back to ${returnOriginLabel}`
                    : `กลับไปที่${returnOriginLabel}`}
                </span>
              </button>
            )}
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#F27D26]" />
              <h1 className="text-2xl font-bold text-white tracking-tight">
                {lang === 'en' ? 'Recipe Management' : 'สูตรอาหาร (Recipe Management)'}
              </h1>
            </div>
          </div>

          {/* 3 Primary Tabs Navigation */}
        <div className="flex bg-black/40 border border-white/15 p-1 rounded-2xl">
          <button
            type="button"
            onClick={() => setActiveTab('FOOD')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'FOOD'
                ? 'bg-[#F27D26] text-black shadow-md shadow-[#F27D26]/20'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <UtensilsCrossed className="w-3.5 h-3.5" />
            <span>
              {lang === 'en'
                ? 'Step 4: Base Recipe Repository'
                : 'ขั้นตอนที่ 4: คลังสูตรอาหารกลาง (Base Recipe Repository)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SAUCE')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'SAUCE'
                ? 'bg-[#F27D26] text-black shadow-md shadow-[#F27D26]/20'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>
              {lang === 'en'
                ? 'Step 3: Sauce & Broth Batches'
                : 'ขั้นตอนที่ 3: ซอสและน้ำซุปกลาง (Sauce Batches)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('RICE_NOODLES')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'RICE_NOODLES'
                ? 'bg-[#F27D26] text-black shadow-md shadow-[#F27D26]/20'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Wheat className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Rice & Noodles (Yield & Portions)' : 'ข้าวและเส้น (Yield & Portions)'}</span>
          </button>
        </div>
        </div>

        {showReturnUnsavedConfirm && returnOriginLabel && onReturnToOrigin && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2 text-amber-950 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {lang === 'en'
                  ? `You have unsaved recipe edits. Save before returning to ${returnOriginLabel}?`
                  : `คุณมีการแก้ไขสูตรกลางที่ยังไม่ได้บันทึก ต้องการบันทึกก่อนกลับไปที่${returnOriginLabel}หรือไม่?`}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  handleSaveBaseRecipe();
                  setShowReturnUnsavedConfirm(false);
                  onReturnToOrigin();
                }}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#F27D26] hover:bg-[#d96817] text-white font-bold cursor-pointer"
              >
                {lang === 'en' ? 'Save & Return' : 'บันทึกแล้วกลับ'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setHasUnsavedChanges(false);
                  setShowReturnUnsavedConfirm(false);
                  onReturnToOrigin();
                }}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 font-bold cursor-pointer"
              >
                {lang === 'en' ? 'Leave Without Saving' : 'กลับโดยไม่บันทึก'}
              </button>
              <button
                type="button"
                onClick={() => setShowReturnUnsavedConfirm(false)}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold cursor-pointer"
              >
                {lang === 'en' ? 'Stay Here' : 'อยู่ต่อ'}
              </button>
            </div>
          </div>
        )}
      </div>


      {/* ========================================================= */}
      {/* TAB 1: CENTRAL BASE RECIPES (คลังสูตรอาหารกลาง)              */}
      {/* ========================================================= */}
      {activeTab === 'FOOD' && (
        <div className="space-y-4">
          {/* Toolbar & Action Header */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-3.5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            <div>
              <h2 className="text-sm font-bold text-white">
                {lang === 'en'
                  ? 'User-Created Central Base Recipes'
                  : 'คลังสูตรอาหารกลาง (สร้างและตั้งชื่อสูตรเอง)'}
              </h2>
              <p className="text-[11px] text-white/55 mt-0.5">
                {lang === 'en'
                  ? 'Tap any compact card to open & edit ingredients, sauces, rice/noodles & packaging inside it.'
                  : 'คลิกการ์ดสูตรแบบย่อเพื่อเปิดดูหรือปรับวัตถุดิบ ซอส ข้าวและเส้น และแพ็คเกจจิ้งภายในตัวการ์ด'}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {hasUnsavedChanges && currentBaseRecipe && (
                <span className="text-xs text-amber-400 font-semibold animate-pulse">
                  ● {lang === 'en' ? 'Unsaved changes' : 'มีการแก้ไขที่ยังไม่ได้บันทึก'}
                </span>
              )}
              {saveSuccessNotice && (
                <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {lang === 'en'
                      ? 'Base recipe saved & synced'
                      : 'บันทึกสูตรอาหารกลางและซิงค์เมนูที่เชื่อมไว้แล้ว'}
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={handleOpenCreateBaseRecipe}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#F27D26]" />
                <span>
                  {lang === 'en' ? '+ Create Base Recipe' : '+ สร้างสูตรอาหารกลางใหม่'}
                </span>
              </button>
              {currentBaseRecipe && (
                <button
                  type="button"
                  onClick={handleSaveBaseRecipe}
                  disabled={!hasUnsavedChanges}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    hasUnsavedChanges
                      ? 'bg-[#F27D26] hover:bg-[#d96817] text-black shadow-lg shadow-[#F27D26]/20'
                      : 'bg-white/10 text-white/40 cursor-not-allowed'
                  }`}
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>
                    {lang === 'en' ? 'Save Base Recipe' : 'บันทึกสูตรอาหารกลาง'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Compact Recipe Cards Grid (การ์ดสูตรอาหารแบบย่อ) */}
          {baseRecipes.length === 0 ? (
            <div className="bg-white/5 backdrop-blur-xl border border-dashed border-white/20 rounded-3xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#F27D26]/15 border border-[#F27D26]/30 text-[#F27D26] flex items-center justify-center mx-auto">
                <BookOpen className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">
                  {lang === 'en'
                    ? 'No central base recipes yet'
                    : 'ยังไม่มีสูตรอาหารกลางในคลัง'}
                </h3>
                <p className="text-xs text-white/55 max-w-md mx-auto">
                  {lang === 'en'
                    ? 'Create your own standalone central base recipes here (independent of main menu names), then select them from the dropdown in Food Cost menus.'
                    : 'สร้างสูตรอาหารกลางด้วยตัวเองได้ที่นี่ (แยกอิสระจากชื่อเมนูอาหารหลัก) แล้วนำไปเลือกใช้จากรายการในหน้าต้นทุนอาหาร'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenCreateBaseRecipe}
                className="px-5 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {lang === 'en' ? '+ Create First Base Recipe' : '+ สร้างสูตรอาหารกลางแรก'}
                </span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {baseRecipes.map((recipe) => {
                const isSelected = currentBaseRecipe?.id === recipe.id;
                const displayItems = isSelected ? localBaseItems : (recipe.items || []);
                const nonPkgCount = displayItems.filter(
                  (it) =>
                    it.type !== 'PACKAGING' &&
                    it.ingredientType !== 'PACKAGING' &&
                    it.type !== 'PREPARED_ITEM' &&
                    it.ingredientType !== 'PREPARED_ITEM'
                ).length;
                const pkgSideCount = displayItems.length - nonPkgCount;
                const cardTotalCost = displayItems.reduce(
                  (sum, it) => sum + getItemCost(it).lineCost,
                  0
                );
                const linkedVariantsCount = menus.reduce(
                  (acc, m) =>
                    acc + (m.variants || []).filter((v) => v.baseRecipeId === recipe.id).length,
                  0
                );

                return (
                  <div
                    key={recipe.id}
                    role={isSelected ? undefined : 'button'}
                    tabIndex={isSelected ? undefined : 0}
                    onClick={isSelected ? undefined : () => handleSelectBaseRecipeCard(recipe)}
                    onKeyDown={
                      isSelected
                        ? undefined
                        : (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelectBaseRecipeCard(recipe);
                            }
                          }
                    }
                    className={`rounded-2xl border transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'col-span-1 sm:col-span-2 lg:col-span-3 xl:col-span-4 p-3 sm:p-3.5 gap-2.5 bg-[#F27D26]/10 border-[#F27D26] shadow-md shadow-[#F27D26]/10'
                        : 'p-3 gap-2 cursor-pointer bg-white/5 border-white/10 hover:border-white/25 hover:bg-white/[0.07]'
                    }`}
                  >
                    {/* Compact Card Header */}
                    <div
                      onClick={isSelected ? () => handleSelectBaseRecipeCard(recipe) : undefined}
                      className={`flex items-center justify-between gap-2 ${
                        isSelected ? 'cursor-pointer' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isSelected ? 'bg-[#F27D26]' : 'bg-white/30'
                            }`}
                          />
                          <h3 className="font-bold text-white text-xs sm:text-sm truncate">
                            {getLocalizedText(lang, recipe.thaiName || recipe.name, recipe.englishName)}
                          </h3>
                          {(() => {
                            const rnItems = displayItems.filter((it) => isRiceNoodleRecipeItem(it));
                            if (rnItems.length === 0) return null;
                            const firstPortion = rnItems[0].riceNoodlePortionId
                              ? riceNoodlePortionsMap.get(rnItems[0].riceNoodlePortionId)
                              : undefined;
                            const label = firstPortion
                              ? lang === 'en'
                                ? firstPortion.nameEn || firstPortion.name
                                : firstPortion.name
                              : rnItems[0].name;
                            return (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#FFC107]/15 border border-[#FFC107]/25 text-[10px] text-[#FFC107] font-semibold truncate max-w-[150px]">
                                <Wheat className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{label}</span>
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {isSelected && hasUnsavedChanges && (
                          <button
                            type="button"
                            onClick={handleSaveBaseRecipe}
                            className="px-2.5 py-1 rounded-lg bg-[#F27D26] hover:bg-[#d96817] text-black text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-sm"
                          >
                            <Save className="w-3 h-3" />
                            <span>{lang === 'en' ? 'Save' : 'บันทึก'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenEditBaseRecipeMeta(recipe)}
                          className="p-1 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
                          title={lang === 'en' ? 'Edit recipe name' : 'แก้ไขชื่อสูตร'}
                          aria-label={lang === 'en' ? 'Edit recipe name' : 'แก้ไขชื่อสูตร'}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setBaseRecipeToDelete(recipe)}
                          className="p-1 rounded-lg text-white/40 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          title={lang === 'en' ? 'Delete base recipe' : 'ลบสูตรอาหารกลาง'}
                          aria-label={lang === 'en' ? 'Delete base recipe' : 'ลบสูตรอาหารกลาง'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectBaseRecipeCard(recipe)}
                          className={`p-1 rounded-lg cursor-pointer transition-colors ${
                            isSelected
                              ? 'text-[#F27D26] bg-[#F27D26]/15 hover:bg-[#F27D26]/25'
                              : 'text-white/40 hover:text-white hover:bg-white/10'
                          }`}
                          title={
                            isSelected
                              ? lang === 'en'
                                ? 'Collapse card'
                                : 'ย่อการ์ด'
                              : lang === 'en'
                              ? 'Expand items'
                              : 'เปิดดูรายการ'
                          }
                          aria-label={
                            isSelected
                              ? lang === 'en'
                                ? 'Collapse card'
                                : 'ย่อการ์ด'
                              : lang === 'en'
                              ? 'Expand items'
                              : 'เปิดดูรายการ'
                          }
                        >
                          {isSelected ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Compact Summary Footer */}
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/10 text-[11px]">
                      <div className="flex items-center gap-1.5 text-white/60 truncate">
                        <span>
                          {nonPkgCount} {lang === 'en' ? 'items' : 'ส่วนประกอบ'}
                        </span>
                        {pkgSideCount > 0 && (
                          <>
                            <span>•</span>
                            <span>
                              {pkgSideCount} {lang === 'en' ? 'pkg' : 'กล่อง'}
                            </span>
                          </>
                        )}
                        {linkedVariantsCount > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-400 font-semibold">
                              {linkedVariantsCount} {lang === 'en' ? 'used' : 'เมนูใช้'}
                            </span>
                          </>
                        )}
                      </div>
                      <span className="font-mono font-bold text-[#FFC107] shrink-0">
                        ฿{cardTotalCost.toFixed(2)}
                      </span>
                    </div>

                    {isSelected && (
                      <div className="pt-2.5 border-t border-[#F27D26]/25 space-y-3">
                        {/* Section 1: Compact Recipe Ingredients, Sauces & Rice/Noodles inside the card */}
                        <div className="space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <span className="font-bold text-white text-xs">
                              {lang === 'en'
                                ? `Base Recipe Items (${nonPackagingItems.length})`
                                : `รายการส่วนประกอบในสูตรกลาง (${nonPackagingItems.length} รายการ)`}
                            </span>

                            {/* 3 Compact Add buttons: วัตถุดิบ, ซอสปรุง, ข้าวและเส้น */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={handleAddBaseIngredient}
                                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                title={lang === 'en' ? 'Add base ingredient' : 'เพิ่มวัตถุดิบกลาง เช่น พริก, กระเทียม, ใบกะเพรา, น้ำมัน'}
                              >
                                <Plus className="w-3 h-3" />
                                <span>{lang === 'en' ? '+ Ingredient' : '+ วัตถุดิบ'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleAddSauce}
                                className="px-2 py-1 rounded-lg bg-[#F27D26]/20 hover:bg-[#F27D26]/30 text-[#F27D26] text-[11px] font-bold flex items-center gap-1 cursor-pointer border border-[#F27D26]/30 transition-colors"
                                title={lang === 'en' ? 'Add batch-prepared sauce' : 'เพิ่มซอสปรุงรส'}
                              >
                                <Plus className="w-3 h-3" />
                                <span>{lang === 'en' ? '+ Sauce' : '+ ซอส'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleOpenAddRiceNoodleModal}
                                disabled={portionRecipes.length === 0}
                                className="px-2 py-1 rounded-lg bg-[#FFC107]/15 hover:bg-[#FFC107]/25 text-[#FFC107] text-[11px] font-bold flex items-center gap-1 cursor-pointer border border-[#FFC107]/30 transition-colors disabled:opacity-40"
                                title={lang === 'en' ? 'Link Rice & Noodles (Yield & Portions)' : 'เพิ่มรายการจากหมวด ข้าวและเส้น'}
                              >
                                <Wheat className="w-3 h-3" />
                                <span>{lang === 'en' ? '+ Rice/Noodles' : '+ ข้าวและเส้น'}</span>
                              </button>
                            </div>
                          </div>

                          {nonPackagingItems.length === 0 ? (
                            <p className="py-2 px-3 text-center text-white/45 text-[11px] border border-dashed border-white/10 rounded-xl">
                              {lang === 'en'
                                ? 'No ingredients yet — use the buttons above to add.'
                                : 'ยังไม่มีรายการส่วนประกอบ กดปุ่มด้านบนเพื่อเพิ่ม'}
                            </p>
                          ) : (
                            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/15">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="border-b border-white/10 text-white/50 text-[10px] uppercase">
                                    <th className="py-1.5 px-2.5">{lang === 'en' ? 'Recipe Item' : 'รายการ'}</th>
                                    <th className="py-1.5 px-2 text-right">{lang === 'en' ? 'Qty' : 'ปริมาณ'}</th>
                                    <th className="py-1.5 px-2">{lang === 'en' ? 'Unit' : 'หน่วย'}</th>
                                    <th className="py-1.5 px-2 text-right">{lang === 'en' ? 'Unit Cost' : 'ทุน/หน่วย'}</th>
                                    <th className="py-1.5 px-2.5 text-right">{lang === 'en' ? 'Total' : 'รวม (฿)'}</th>
                                    <th className="py-1.5 px-2 text-center">{lang === 'en' ? 'Del' : 'ลบ'}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 font-mono">
                                  {nonPackagingItems.map((item, index) => {
                                    const costInfo = getItemCost(item);

                                    return (
                                      <tr key={`${item.id || 'item'}-${index}`} className="hover:bg-white/5 transition-colors">
                                        <td className="py-1.5 px-2.5 font-sans font-medium text-white">
                                          {isRiceNoodleRecipeItem(item) ? (
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5">
                                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FFC107]/15 text-[#FFC107] border border-[#FFC107]/30 text-[10px] font-bold shrink-0">
                                                <Wheat className="w-2.5 h-2.5" />
                                                <span>{lang === 'en' ? 'Rice/Noodles' : 'ข้าว/เส้น'}</span>
                                              </span>
                                              <select
                                                value={item.riceNoodlePortionId || ''}
                                                onChange={(e) => handleUpdateBaseItemSourceById(item.id || '', e.target.value)}
                                                className="bg-black/50 border border-white/15 rounded-lg px-2 py-1 text-xs text-white max-w-[220px] cursor-pointer"
                                              >
                                                {portionRecipes.map((p) => (
                                                  <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                                                    {lang === 'en' ? p.nameEn || p.name : p.name} ({p.portionGram}g · ฿{Number(p.costPerPortion || 0).toFixed(2)})
                                                  </option>
                                                ))}
                                              </select>
                                              {(() => {
                                                const linkedP = item.riceNoodlePortionId
                                                  ? riceNoodlePortionsMap.get(item.riceNoodlePortionId)
                                                  : undefined;
                                                if (!linkedP) return null;
                                                return (
                                                  <span className="text-[10px] text-emerald-400 font-mono whitespace-nowrap">
                                                    Yield: {lang === 'en' ? linkedP.cookingYieldEn || linkedP.cookingYield : linkedP.cookingYield}
                                                  </span>
                                                );
                                              })()}
                                            </div>
                                          ) : item.type === 'SAUCE' ? (
                                            <select
                                              value={item.ingredientId || item.sauceId}
                                              onChange={(e) => handleUpdateBaseItemSourceById(item.id || '', e.target.value)}
                                              className="bg-black/50 border border-white/15 rounded-lg px-2 py-1 text-xs text-white cursor-pointer"
                                            >
                                              {sauces.map((s) => (
                                                <option key={s.id} value={s.id} className="bg-[#1a1a1a]">
                                                  {getLocalizedText(lang, s.thaiName || s.name, s.englishName)}
                                                </option>
                                              ))}
                                            </select>
                                          ) : (
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5">
                                              <select
                                                value={(item.id && baseItemCategoryOverrides[item.id]) || ingredientsMap.get(item.ingredientId)?.category || 'ALL'}
                                                onChange={(e) => {
                                                  const newCat = e.target.value;
                                                  const safeId = item.id || '';
                                                  if (safeId) {
                                                    setBaseItemCategoryOverrides((prev) => ({ ...prev, [safeId]: newCat }));
                                                  }
                                                  const matching = newCat === 'ALL' ? ingredients : ingredients.filter((i) => i.category === newCat);
                                                  if (matching.length > 0 && !matching.some((i) => i.id === item.ingredientId)) {
                                                    handleUpdateBaseItemSourceById(safeId, matching[0].id);
                                                  }
                                                }}
                                                className="bg-black/60 border border-white/20 rounded-lg px-2 py-1 text-[11px] text-[#F27D26] font-bold cursor-pointer shrink-0 max-w-[125px]"
                                                title={lang === 'en' ? '1. Select ingredient category first' : '1. เลือกหมวดหมู่วัตถุดิบก่อน'}
                                              >
                                                <option value="ALL">{lang === 'en' ? '📁 All Categories' : '📁 ทุกหมวด'}</option>
                                                {uniqueCategories.map((cat) => (
                                                  <option key={cat} value={cat} className="bg-[#1a1a1a] text-white">
                                                    {getCategoryIcon(cat)} {getLocalizedText(lang, cat)}
                                                  </option>
                                                ))}
                                              </select>

                                              {(() => {
                                                const selectedCat = (item.id && baseItemCategoryOverrides[item.id]) || ingredientsMap.get(item.ingredientId)?.category || 'ALL';
                                                const categoryIngs = selectedCat === 'ALL'
                                                  ? ingredients
                                                  : ingredients.filter((i) => i.category === selectedCat);

                                                return (
                                                  <select
                                                    value={item.ingredientId}
                                                    onChange={(e) => handleUpdateBaseItemSourceById(item.id || '', e.target.value)}
                                                    className="bg-black/50 border border-white/15 rounded-lg px-2 py-1 text-xs text-white max-w-[185px] cursor-pointer"
                                                    title={lang === 'en' ? '2. Select sub-ingredient' : '2. เลือกวัตถุดิบย่อย'}
                                                  >
                                                    {categoryIngs.map((ing) => (
                                                      <option key={ing.id} value={ing.id} className="bg-[#1a1a1a]">
                                                        {getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName)}
                                                      </option>
                                                    ))}
                                                  </select>
                                                );
                                              })()}
                                            </div>
                                          )}
                                        </td>

                                        <td className="py-1.5 px-2 text-right">
                                          <NumericInput
                                            type="number"
                                            step="any"
                                            min="0"
                                            value={item.quantity ?? 0}
                                            onChange={(e) =>
                                              handleUpdateBaseItemQuantityById(item.id || '', parseFloat(e.target.value) || 0)
                                            }
                                            className="w-16 p-1 bg-black/40 border border-white/20 rounded-lg text-right text-white font-mono font-bold focus:border-[#F27D26]"
                                          />
                                        </td>

                                        <td className="py-1.5 px-2 font-sans text-white/50 text-[11px]">
                                          {localizeUnit(item.unit, lang)}
                                        </td>

                                        <td className="py-1.5 px-2 text-right text-white/60">
                                          <div className="flex flex-col items-end">
                                            <span>฿{costInfo.unitCost.toFixed(costInfo.unitCost < 1 ? 4 : 2)}</span>
                                            {costInfo.missingPrice && (
                                              <span className="mt-0.5 px-1.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                                                {lang === 'en' ? 'No price' : 'ไม่มีราคา'}
                                              </span>
                                            )}
                                          </div>
                                        </td>

                                        <td className="py-1.5 px-2.5 text-right font-bold text-white">
                                          ฿{costInfo.lineCost.toFixed(2)}
                                        </td>

                                        <td className="py-1.5 px-2 text-center">
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveBaseItemById(item.id || '')}
                                            className="p-1 text-white/40 hover:text-rose-400 cursor-pointer transition-colors"
                                            title={lang === 'en' ? 'Remove this item' : 'ลบรายการนี้'}
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
                          )}
                        </div>

                        {/* Section 2: Compact Packaging & Side Dish Items inside the card */}
                        <div className="pt-2 border-t border-white/10 space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Package className="w-3.5 h-3.5 text-[#00B1FF] shrink-0" />
                              <span className="font-bold text-white text-xs">
                                {lang === 'en'
                                  ? `Packaging & Sides (${packagingAndSideItems.length})`
                                  : `กล่อง บรรจุภัณฑ์ & เครื่องเคียง (${packagingAndSideItems.length} รายการ)`}
                              </span>
                              {packagingAndSideItems.length > 0 && (
                                <span className="font-mono text-[11px] font-bold text-[#00B1FF]">
                                  · ฿{(totalPackagingCost + totalSideDishCost).toFixed(2)}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                              <button
                                type="button"
                                onClick={handleAddSideDish}
                                className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer border border-amber-500/30 transition-colors"
                                title={lang === 'en' ? 'Add side dishes' : 'เพิ่มเครื่องเคียง'}
                              >
                                <Plus className="w-3 h-3" />
                                <span>{lang === 'en' ? '+ Side' : '+ เครื่องเคียง'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleAddPackaging}
                                className="px-2 py-1 rounded-lg bg-[#00B1FF]/20 hover:bg-[#00B1FF]/30 text-[#00B1FF] border border-[#00B1FF]/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                                title={lang === 'en' ? 'Add packaging' : 'เพิ่มแพ็คเกจจิ้ง'}
                              >
                                <Plus className="w-3 h-3" />
                                <span>{lang === 'en' ? '+ Packaging' : '+ แพ็คเกจจิ้ง'}</span>
                              </button>
                            </div>
                          </div>

                          {packagingAndSideItems.length > 0 && (
                            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/15">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="border-b border-white/10 text-white/50 text-[10px] uppercase">
                                    <th className="py-1.5 px-2.5">{lang === 'en' ? 'Packaging / Side' : 'รายการกล่อง / เครื่องเคียง'}</th>
                                    <th className="py-1.5 px-2 text-right">{lang === 'en' ? 'Qty' : 'จำนวน'}</th>
                                    <th className="py-1.5 px-2">{lang === 'en' ? 'Unit' : 'หน่วย'}</th>
                                    <th className="py-1.5 px-2 text-right">{lang === 'en' ? 'Unit Cost' : 'ทุน/หน่วย'}</th>
                                    <th className="py-1.5 px-2.5 text-right">{lang === 'en' ? 'Total' : 'รวม (฿)'}</th>
                                    <th className="py-1.5 px-2 text-center">{lang === 'en' ? 'Del' : 'ลบ'}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 font-mono">
                                  {packagingAndSideItems.map((item, index) => {
                                    const costInfo = getItemCost(item);

                                    return (
                                      <tr key={`${item.id || 'pkg'}-${index}`} className="hover:bg-white/5 transition-colors">
                                        <td className="py-1.5 px-2.5 font-sans font-medium text-white">
                                          {item.type === 'PREPARED_ITEM' ? (
                                            <select
                                              value={item.ingredientId}
                                              onChange={(e) => handleUpdateBaseItemSourceById(item.id || '', e.target.value)}
                                              className="bg-black/50 border border-white/15 rounded-lg px-2 py-1 text-xs text-white max-w-[240px] cursor-pointer"
                                            >
                                              <optgroup label={lang === 'en' ? 'Standard Side Dishes (Presets)' : 'เครื่องเคียงมาตรฐาน (Presets)'} className="bg-[#1a1a1a]">
                                                {SIDE_DISH_PRESETS.map((sd) => (
                                                  <option key={sd.id} value={sd.id}>
                                                    {getLocalizedText(lang, sd.name)}
                                                  </option>
                                                ))}
                                              </optgroup>
                                              <optgroup label={lang === 'en' ? 'Additional Stock Ingredients' : 'วัตถุดิบเสริมในคลัง'} className="bg-[#1a1a1a]">
                                                {ingredients.map((ing) => (
                                                  <option key={ing.id} value={ing.id}>
                                                    {getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName)}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            </select>
                                          ) : (
                                            <select
                                              value={item.ingredientId}
                                              onChange={(e) => handleUpdateBaseItemSourceById(item.id || '', e.target.value)}
                                              className="bg-black/50 border border-white/15 rounded-lg px-2 py-1 text-xs text-white max-w-[240px] cursor-pointer"
                                            >
                                              <optgroup label={lang === 'en' ? 'Standard Items (Presets)' : 'รายการมาตรฐาน (Presets)'} className="bg-[#1a1a1a]">
                                                {PACKAGING_PRESETS.map((pkg) => (
                                                  <option key={pkg.id} value={pkg.id}>
                                                    {getLocalizedText(lang, pkg.name)}
                                                  </option>
                                                ))}
                                              </optgroup>
                                              <optgroup label={lang === 'en' ? 'Packaging Stock Items' : 'วัตถุดิบบรรจุภัณฑ์ในคลัง'} className="bg-[#1a1a1a]">
                                                {ingredients
                                                  .filter((i) => i.category === 'บรรจุภัณฑ์')
                                                  .map((ing) => (
                                                    <option key={ing.id} value={ing.id}>
                                                      {getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName)}
                                                    </option>
                                                  ))}
                                              </optgroup>
                                            </select>
                                          )}
                                        </td>

                                        <td className="py-1.5 px-2 text-right">
                                          <NumericInput
                                            type="number"
                                            step="any"
                                            min="0"
                                            value={item.quantity ?? 1}
                                            onChange={(e) =>
                                              handleUpdateBaseItemQuantityById(item.id || '', parseFloat(e.target.value) || 0)
                                            }
                                            className="w-14 p-1 bg-black/40 border border-white/20 rounded-lg text-right text-white font-mono font-bold focus:border-[#00B1FF]"
                                          />
                                        </td>

                                        <td className="py-1.5 px-2 font-sans text-white/50 text-[11px]">
                                          {localizeUnit(item.unit || 'ชิ้น', lang)}
                                        </td>

                                        <td className="py-1.5 px-2 text-right text-white/60">
                                          ฿{costInfo.unitCost.toFixed(2)}
                                        </td>

                                        <td className="py-1.5 px-2.5 text-right font-bold text-[#00B1FF]">
                                          ฿{costInfo.lineCost.toFixed(2)}
                                        </td>

                                        <td className="py-1.5 px-2 text-center">
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveBaseItemById(item.id || '')}
                                            className="p-1 text-white/40 hover:text-rose-400 cursor-pointer transition-colors"
                                            title={lang === 'en' ? 'Remove this item' : 'ลบรายการนี้'}
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
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: MAIN SAUCES (ซอสหลัก)                                */}
      {/* ========================================================= */}
      {activeTab === 'SAUCE' && (
        <div className="space-y-4">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-4 rounded-3xl flex items-center justify-end">
            <button
              type="button"
              onClick={handleOpenAddSauce}
              className="px-4 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === 'en' ? '+ Create Sauce Recipe' : '+ สร้างสูตรซอสใหม่'}</span>
            </button>
          </div>

          {/* Sauces Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sauces.map((sauce) => {
              const calc = calculateSauceCost(sauce, ingredientsMap);
              return (
                <div
                  key={sauce.id}
                  className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-5 hover:border-white/20 transition-all flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-white text-base">
                      {getLocalizedText(lang, sauce.thaiName || sauce.name, sauce.englishName)}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleOpenEditSauce(sauce)}
                      className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                      title={lang === 'en' ? 'Edit Sauce Recipe' : 'แก้ไขสูตรซอส'}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Batch stats */}
                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10 text-xs font-mono">
                    <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                      <span className="text-[10px] font-sans text-white/40 block">
                        {lang === 'en' ? 'Batch Output' : 'ปริมาณผลิต (Batch)'}
                      </span>
                      <span className="font-bold text-white mt-0.5 block">
                        {sauce.productionQuantity} {localizeUnit(sauce.productionUnit, lang)}
                      </span>
                    </div>

                    <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                      <span className="text-[10px] font-sans text-white/40 block">
                        {lang === 'en' ? 'Cost per Unit' : 'ต้นทุนต่อหน่วย'}
                      </span>
                      {calc.isValid ? (
                        <span className="font-bold text-[#FFC107] mt-0.5 block">
                          ฿{calc.costPerGram.toFixed(4)}
                        </span>
                      ) : (
                        <span className="font-bold text-rose-400 text-[11px] mt-0.5 block">
                          {calc.errorMessage ? getLocalizedText(lang, calc.errorMessage) : (lang === 'en' ? 'Incomplete data' : 'ข้อมูลไม่ครบ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: RICE & NOODLES (ข้าวและเส้น)                         */}
      {/* ========================================================= */}
      {activeTab === 'RICE_NOODLES' && (
        <div className="space-y-4">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wheat className="w-5 h-5 text-[#FFC107]" />
              <h2 className="text-lg font-bold text-white">
                {lang === 'en'
                  ? 'Rice & Noodle Portioning & Costing'
                  : 'การจัดการต้นทุน ข้าวและเส้น (Rice & Noodle Portioning)'}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleOpenAddPortion}
              className="px-4 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === 'en' ? '+ Add Rice / Noodle Recipe' : '+ เพิ่มสูตรข้าวและเส้น'}</span>
            </button>
          </div>

          {/* Portion Cards Grid */}
          {portionRecipes.length === 0 ? (
            <div className="bg-white/5 backdrop-blur-xl border border-dashed border-white/20 rounded-3xl p-8 text-center space-y-3">
              <p className="text-xs text-white/60">
                {lang === 'en'
                  ? 'No rice or noodle portion recipes yet.'
                  : 'ยังไม่มีสูตรข้าวและเส้น คลิกปุ่มด้านบนเพื่อเพิ่มสูตรใหม่'}
              </p>
              <button
                type="button"
                onClick={handleOpenAddPortion}
                className="px-4 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{lang === 'en' ? '+ Add Rice / Noodle Recipe' : '+ เพิ่มสูตรข้าวและเส้น'}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {portionRecipes.map((portion) => (
                <div
                  key={portion.id}
                  className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-5 hover:border-white/20 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFC107]/20 text-[#FFC107]">
                        {lang === 'en' ? portion.typeEn : portion.type}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-white/40 font-mono">
                          {lang === 'en' ? 'Serving:' : 'ขนาดเสิร์ฟ:'} {portion.portionGram}g
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenEditPortion(portion)}
                          className="p-1.5 rounded-xl text-white/45 hover:text-white hover:bg-white/10 cursor-pointer"
                          title={lang === 'en' ? 'Edit Rice/Noodle Recipe' : 'แก้ไขสูตรข้าวและเส้น'}
                          aria-label={lang === 'en' ? 'Edit Rice/Noodle Recipe' : 'แก้ไขสูตรข้าวและเส้น'}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPortionToDelete(portion)}
                          className="p-1.5 rounded-xl text-white/40 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          title={lang === 'en' ? 'Delete Rice/Noodle Recipe' : 'ลบสูตรข้าวและเส้น'}
                          aria-label={lang === 'en' ? 'Delete Rice/Noodle Recipe' : 'ลบสูตรข้าวและเส้น'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h3 className="font-bold text-white text-base">
                      {lang === 'en' ? portion.nameEn : portion.name}
                    </h3>

                    {/* Details table */}
                    <div className="mt-3 p-3 rounded-2xl bg-black/30 border border-white/5 space-y-1.5 text-xs font-mono">
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-white/50">
                          {lang === 'en' ? 'Base Ingredient:' : 'วัตถุดิบหลัก:'}
                        </span>
                        <span className="text-white text-right">
                          {lang === 'en' ? portion.rawIngredientNameEn : portion.rawIngredientName}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-white/50">
                          {lang === 'en' ? 'Market Price:' : 'ราคาตลาด:'}
                        </span>
                        <span className="text-white text-right">
                          {lang === 'en' ? portion.rawPurchaseCostEn : portion.rawPurchaseCost}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-white/50">
                          {lang === 'en' ? 'Cooking Yield:' : 'Yield การหุง/ลวก:'}
                        </span>
                        <span className="text-emerald-400 font-bold text-right">
                          {lang === 'en' ? portion.cookingYieldEn : portion.cookingYield}
                        </span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-white/10 font-bold text-sm">
                        <span className="font-sans text-white">
                          {lang === 'en' ? 'Cost per Dish:' : 'ต้นทุนต่อจาน:'}
                        </span>
                        <span className="text-[#FFC107]">฿{Number(portion.costPerPortion || 0).toFixed(2)}</span>
                      </div>
                    </div>

                    {(lang === 'en' ? portion.dishesUsingEn : portion.dishesUsing)?.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {(lang === 'en' ? portion.dishesUsingEn : portion.dishesUsing).map((dish, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-[10px] text-white/60"
                          >
                            {dish}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SAUCE EDIT MODAL */}
      {isSauceModalOpen && editingSauce && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="modal-panel-fixed bg-[#1a1a1a] rounded-3xl max-w-lg w-full shadow-2xl border border-white/20 text-white">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h3 className="font-bold text-white text-base">
                {editingSauce.id?.startsWith('sauce_') && !sauces.find((s) => s.id === editingSauce.id)
                  ? lang === 'en' ? 'Create New Sauce Recipe' : 'สร้างสูตรซอสใหม่'
                  : lang === 'en' ? 'Edit Sauce Recipe' : 'แก้ไขสูตรซอส'}
              </h3>
              <button
                type="button"
                onClick={() => setIsSauceModalOpen(false)}
                className="p-1 rounded-xl text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSauceModal} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4 scrollbar-thin">
              <div className="space-y-3">
                <div>
                  <label className="block text-white/70 mb-1 font-semibold">
                    {lang === 'en' ? 'Sauce Recipe Name (Thai)' : 'ชื่อสูตรซอส (ไทย)'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={lang === 'en' ? 'e.g. Classic Holy Basil Stir-fry Sauce' : 'เช่น ซอสผัดกะเพราโบราณ, ซอสพริกไทยดำ'}
                    value={editingSauce.name || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setSauceFormError(null);
                      setEditingSauce((prev) =>
                        prev ? { ...prev, name: nextTh, thaiName: nextTh } : prev
                      );
                      sauceTranslationScheduler.schedule('sauce', () => {
                        setEditingSauce((prev) => {
                          if (!prev) return prev;
                          const currTh = prev.name || '';
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevSauceThaiRef.current,
                            nextThai: currTh,
                            currentEnglish: prev.englishName,
                            isManuallyEdited: Boolean(prev.englishNameManual),
                          });
                          prevSauceThaiRef.current = currTh;
                          return { ...prev, englishName: nextEn };
                        });
                      });
                    }}
                    onBlur={() => sauceTranslationScheduler.flush('sauce')}
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white focus:outline-none focus:border-[#F27D26]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <label className="block text-white/70 font-semibold">
                        {lang === 'en' ? 'Sauce Name (English — Auto-translated)' : 'ชื่อสูตรซอส (English Name — แปลอัตโนมัติ)'}
                      </label>
                      {needsEnglishReview(editingSauce.name, editingSauce.englishName) && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-400">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{lang === 'en' ? 'Needs EN' : 'รอตรวจสอบ EN'}</span>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        sauceTranslationScheduler.cancel('sauce');
                        prevSauceThaiRef.current = editingSauce.name || '';
                        setEditingSauce({
                          ...editingSauce,
                          englishName: translateThaiToEnglish(editingSauce.name || ''),
                          englishNameManual: false,
                        });
                      }}
                      className="text-[11px] font-bold text-[#F27D26] hover:underline cursor-pointer"
                    >
                      {lang === 'en' ? 'Re-translate from Thai' : 'แปลใหม่จากภาษาไทย'}
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder={lang === 'en' ? 'Auto-translated English sauce name' : 'ชื่อซอสภาษาอังกฤษที่แปลอัตโนมัติ'}
                    value={editingSauce.englishName || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      sauceTranslationScheduler.cancel('sauce');
                      setSauceFormError(null);
                      setEditingSauce({
                        ...editingSauce,
                        englishName: val,
                        englishNameManual: Boolean(val.trim()),
                      });
                    }}
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-amber-200 focus:outline-none focus:border-[#F27D26]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-white/70 mb-1 font-semibold">
                    {lang === 'en' ? 'Actual Yield Quantity' : 'ปริมาณสุทธิที่ได้ (Actual Yield)'}
                  </label>
                  <NumericInput
                    type="number"
                    min="0"
                    step="any"
                    required
                    placeholder={lang === 'en' ? 'e.g. 600' : 'เช่น 600'}
                    value={editingSauce.actualQuantity ?? ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setSauceFormError(null);
                      setEditingSauce({
                        ...editingSauce,
                        actualQuantity: Number.isFinite(val) ? val : 0,
                      });
                    }}
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white focus:outline-none focus:border-[#F27D26]"
                  />
                </div>
                <div>
                  <label className="block text-white/70 mb-1 font-semibold">
                    {lang === 'en' ? 'Production Unit' : 'หน่วยผลิตซอส'}
                  </label>
                  <select
                    value={editingSauce.productionUnit || 'g'}
                    onChange={(e) => {
                      setSauceFormError(null);
                      setEditingSauce({ ...editingSauce, productionUnit: e.target.value as UnitType });
                    }}
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white cursor-pointer"
                  >
                    <option value="g" className="bg-[#1a1a1a]">{lang === 'en' ? 'g (grams)' : 'g (กรัม)'}</option>
                    <option value="ml" className="bg-[#1a1a1a]">{lang === 'en' ? 'ml (milliliters)' : 'ml (มิลลิลิตร)'}</option>
                  </select>
                </div>
              </div>

              {sauceFormError && (
                <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-xl text-[11px] text-rose-300 font-semibold">
                  {sauceFormError}
                </div>
              )}

              {/* Items in Sauce */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-white/70 font-semibold">
                    {lang === 'en'
                      ? `Sauce Ingredients & Ratios (${(editingSauce.items || []).length})`
                      : `วัตถุดิบและสัดส่วนในซอส (${(editingSauce.items || []).length})`}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const seasoningIng =
                        ingredients.find((i) => i.category === 'เครื่องปรุงและซอส') ||
                        ingredients[0];
                      if (!seasoningIng) return;
                      const newItem: SauceRecipeItem = {
                        ingredientId: seasoningIng.id,
                        ingredientName: seasoningIng.name,
                        quantity: 100,
                        unit: seasoningIng.usageUnit || 'g',
                        unitCost: seasoningIng.costPerBaseUnit,
                        lineCost: 100 * seasoningIng.costPerBaseUnit,
                      };
                      const newItems = [...(editingSauce.items || []), newItem];
                      setEditingSauce({
                        ...editingSauce,
                        items: newItems,
                      });
                    }}
                    className="text-[10px] text-[#F27D26] hover:underline font-bold"
                  >
                    {lang === 'en' ? '+ Add Sauce Ingredient' : '+ เพิ่มวัตถุดิบในซอส'}
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {(editingSauce.items || []).map((item, idx) => {
                    const seasoningOptions = ingredients.filter((i) => i.category === 'เครื่องปรุงและซอส');
                    const currentIng = ingredientsMap.get(item.ingredientId);
                    const displayOptions =
                      currentIng && !seasoningOptions.some((i) => i.id === currentIng.id)
                        ? [currentIng, ...seasoningOptions]
                        : seasoningOptions.length > 0
                        ? seasoningOptions
                        : ingredients;

                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2 bg-black/30 border border-white/10 rounded-xl"
                      >
                        {/* Ingredient selector - only เครื่องปรุงและซอส, displaying name only */}
                        <select
                          value={item.ingredientId}
                          onChange={(e) => {
                            const ing = ingredientsMap.get(e.target.value);
                            const updated = [...(editingSauce.items || [])];
                            if (ing) {
                              updated[idx] = {
                                ...updated[idx],
                                ingredientId: ing.id,
                                ingredientName: ing.name,
                                unit: ing.usageUnit,
                                unitCost: ing.costPerBaseUnit,
                                lineCost: (updated[idx].quantity || 0) * ing.costPerBaseUnit,
                              };
                              setEditingSauce({ ...editingSauce, items: updated });
                            }
                          }}
                          className="bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white flex-1 cursor-pointer"
                        >
                          {displayOptions.map((ing) => (
                            <option key={ing.id} value={ing.id} className="bg-[#1a1a1a]">
                              {getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName)}
                            </option>
                          ))}
                        </select>

                        <NumericInput
                          type="number"
                          min="0"
                          step="any"
                          value={item.quantity ?? 0}
                          onChange={(e) => {
                            const q = parseFloat(e.target.value) || 0;
                            const updated = [...(editingSauce.items || [])];
                            updated[idx] = {
                              ...updated[idx],
                              quantity: q,
                              lineCost: q * (updated[idx].unitCost || 0),
                            };
                            setEditingSauce({ ...editingSauce, items: updated });
                          }}
                          className="w-16 p-1 bg-black/40 border border-white/20 rounded-lg text-right text-white font-mono font-bold"
                        />

                        <span className="text-[11px] text-white/50">{localizeUnit(item.unit, lang)}</span>

                        <span className="text-[11px] font-mono font-semibold text-[#FFC107] whitespace-nowrap">
                          ฿{(currentIng?.costPerBaseUnit ?? item.unitCost ?? 0).toFixed(4)}/{localizeUnit(item.unit, lang)}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...(editingSauce.items || [])];
                            updated.splice(idx, 1);
                            setEditingSauce({ ...editingSauce, items: updated });
                          }}
                          className="p-1 text-white/40 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              </div>

              <div className="modal-footer bg-[#1a1a1a] flex justify-end gap-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsSauceModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-white font-semibold cursor-pointer"
                >
                  {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer"
                >
                  {lang === 'en' ? 'Save Sauce Recipe' : 'บันทึกสูตรซอส'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD BASE INGREDIENT MODAL (2-step Category & Sub-ingredient) */}
      {isAddBaseIngModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="modal-panel bg-[#1a1a1a] rounded-3xl max-w-md w-full shadow-2xl border border-white/20 text-white">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h3 className="font-bold text-white text-base">
                {lang === 'en'
                  ? '+ Add Ingredient to Base Recipe'
                  : '+ เพิ่มวัตถุดิบในสูตรอาหารกลาง (Base Recipe)'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddBaseIngModalOpen(false)}
                className="p-1 rounded-xl text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmAddBaseIngredient} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
              {/* Step 1: Select Category first */}
              <div>
                <label className="block text-white/80 font-bold mb-1">
                  {lang === 'en' ? '1. Select Ingredient Category First' : '1. เลือกหมวดหมู่วัตถุดิบก่อน'}{' '}
                  <span className="text-[#F27D26]">*</span>
                </label>
                <select
                  value={newBaseIngCategory}
                  onChange={(e) => {
                    const newCat = e.target.value;
                    setNewBaseIngCategory(newCat);
                    const matching = newCat === 'ALL' ? ingredients : ingredients.filter((i) => i.category === newCat);
                    if (matching.length > 0) {
                      setNewBaseIngId(matching[0].id);
                      setNewBaseIngQty(matching[0].usageUnit === 'g' ? 10 : 1);
                    } else {
                      setNewBaseIngId('');
                    }
                  }}
                  className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-bold text-white cursor-pointer focus:border-[#F27D26]"
                >
                  <option value="ALL">{lang === 'en' ? '📁 All Ingredient Categories' : '📁 ทุกหมวดหมู่วัตถุดิบ'}</option>
                  {uniqueCategories.map((cat) => (
                    <option key={cat} value={cat} className="bg-[#1a1a1a] text-white">
                      {getCategoryIcon(cat)} {getLocalizedText(lang, cat)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Step 2: Select Sub-ingredient */}
              <div>
                <label className="block text-white/80 font-bold mb-1">
                  {lang === 'en' ? '2. Select Sub-ingredient' : '2. เลือกวัตถุดิบย่อย'}{' '}
                  <span className="text-[#F27D26]">*</span>
                </label>
                {(() => {
                  const matching = newBaseIngCategory === 'ALL'
                    ? ingredients
                    : ingredients.filter((i) => i.category === newBaseIngCategory);

                  return (
                    <select
                      value={newBaseIngId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setNewBaseIngId(id);
                        const ing = ingredientsMap.get(id);
                        if (ing) {
                          setNewBaseIngQty(ing.usageUnit === 'g' ? 10 : 1);
                        }
                      }}
                      required
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-bold text-white cursor-pointer focus:border-[#F27D26]"
                    >
                      <option value="">
                        {lang === 'en'
                          ? `-- Select Sub-ingredient (${matching.length} items) --`
                          : `-- เลือกวัตถุดิบย่อย (${matching.length} รายการ) --`}
                      </option>
                      {matching.map((ing) => (
                        <option key={ing.id} value={ing.id} className="bg-[#1a1a1a]">
                          {getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName)}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>

              {/* Step 3: Quantity */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-white/80 font-bold">
                    {lang === 'en' ? 'Quantity in Base Recipe' : 'ปริมาณที่ใช้ในสูตรกลาง (Quantity)'}{' '}
                    <span className="text-[#F27D26]">*</span>
                  </label>
                  {newBaseIngId && ingredientsMap.get(newBaseIngId) && (
                    <span className="text-[11px] text-[#F27D26] font-mono font-bold">
                      {lang === 'en' ? 'Unit:' : 'หน่วย:'}{' '}
                      {localizeUnit(ingredientsMap.get(newBaseIngId)?.usageUnit, lang)}
                    </span>
                  )}
                </div>
                <NumericInput
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={newBaseIngQty}
                  onChange={(e) => setNewBaseIngQty(parseFloat(e.target.value) || 0)}
                  className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-mono font-bold text-white focus:border-[#F27D26]"
                />
              </div>

              </div>

              <div className="modal-footer bg-[#1a1a1a] flex justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAddBaseIngModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-white font-semibold cursor-pointer"
                >
                  {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  disabled={!newBaseIngId}
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer disabled:opacity-50"
                >
                  {lang === 'en' ? '+ Add to Base Recipe' : '+ เพิ่มลงสูตรอาหารกลาง'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD RICE & NOODLES PORTION TO BASE RECIPE MODAL */}
      {isAddRiceNoodleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="modal-panel bg-[#1a1a1a] rounded-3xl max-w-md w-full shadow-2xl border border-white/20 text-white">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-2">
                <Wheat className="w-4 h-4 text-[#FFC107]" />
                <h3 className="font-bold text-white text-base">
                  {lang === 'en'
                    ? '+ Add Rice & Noodles (Yield & Portions)'
                    : '+ เพิ่มข้าวและเส้นจากหมวด Yield & Portions'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddRiceNoodleModalOpen(false)}
                className="p-1 rounded-xl text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmAddRiceNoodle} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
                <div>
                  <label className="block text-white/80 font-bold mb-1">
                    {lang === 'en'
                      ? '1. Select Rice / Noodle Recipe'
                      : '1. เลือกสูตรจากหมวด ข้าวและเส้น (Yield & Portions)'}{' '}
                    <span className="text-[#FFC107]">*</span>
                  </label>
                  <select
                    value={newRiceNoodlePortionId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setNewRiceNoodlePortionId(nextId);
                      const p = riceNoodlePortionsMap.get(nextId);
                      if (p) {
                        setNewRiceNoodleQty(p.portionGram || 150);
                      }
                    }}
                    required
                    className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-bold text-white cursor-pointer focus:border-[#FFC107]"
                  >
                    {portionRecipes.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                        {lang === 'en' ? p.nameEn || p.name : p.name} ({p.portionGram}g · ฿{Number(p.costPerPortion || 0).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-white/80 font-bold">
                      {lang === 'en' ? '2. Serving Weight (g)' : '2. ปริมาณที่ใช้ในสูตรกลาง (กรัม)'}{' '}
                      <span className="text-[#FFC107]">*</span>
                    </label>
                    {newRiceNoodlePortionId && riceNoodlePortionsMap.get(newRiceNoodlePortionId) && (
                      <span className="text-[11px] text-emerald-400 font-mono">
                        Yield: {riceNoodlePortionsMap.get(newRiceNoodlePortionId)?.cookingYield}
                      </span>
                    )}
                  </div>
                  <NumericInput
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={newRiceNoodleQty}
                    onChange={(e) => setNewRiceNoodleQty(parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-mono font-bold text-white focus:border-[#FFC107]"
                  />
                </div>

                {(() => {
                  const p = riceNoodlePortionsMap.get(newRiceNoodlePortionId);
                  if (!p) return null;
                  const unitCost = p.portionGram > 0 ? p.costPerPortion / p.portionGram : 0;
                  const lineCost = (newRiceNoodleQty > 0 ? newRiceNoodleQty : 0) * unitCost;
                  return (
                    <div className="p-3 rounded-2xl bg-[#FFC107]/10 border border-[#FFC107]/25 space-y-1">
                      <div className="flex justify-between text-white/75">
                        <span>{lang === 'en' ? 'Base Ingredient:' : 'วัตถุดิบหลัก:'}</span>
                        <span className="font-semibold text-white">
                          {lang === 'en' ? p.rawIngredientNameEn || p.rawIngredientName : p.rawIngredientName}
                        </span>
                      </div>
                      <div className="flex justify-between text-white/75">
                        <span>{lang === 'en' ? 'Standard Portion:' : 'ขนาดมาตรฐาน:'}</span>
                        <span className="font-mono text-white">
                          {p.portionGram}g (฿{Number(p.costPerPortion || 0).toFixed(2)})
                        </span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-[#FFC107]/20 font-bold text-sm">
                        <span className="text-white">{lang === 'en' ? 'Calculated Cost:' : 'ต้นทุนที่คำนวณได้:'}</span>
                        <span className="font-mono text-[#FFC107]">฿{lineCost.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="modal-footer bg-[#1a1a1a] flex justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAddRiceNoodleModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-white font-semibold cursor-pointer"
                >
                  {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  disabled={!newRiceNoodlePortionId}
                  className="px-5 py-2 bg-[#FFC107] hover:bg-[#e6ad00] text-black font-bold rounded-xl shadow-lg shadow-[#FFC107]/20 cursor-pointer disabled:opacity-50"
                >
                  {lang === 'en' ? '+ Add to Base Recipe' : '+ เพิ่มข้าว/เส้นลงสูตรกลาง'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE / EDIT CENTRAL BASE RECIPE MODAL */}
      {isBaseRecipeMetaModalOpen && editingBaseRecipeMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="modal-panel-fixed bg-[#1a1a1a] rounded-3xl max-w-md w-full shadow-2xl border border-white/20 text-white">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h3 className="font-bold text-white text-base">
                {baseRecipes.some((r) => r.id === editingBaseRecipeMeta.id)
                  ? lang === 'en'
                    ? 'Edit Central Base Recipe'
                    : 'แก้ไขชื่อสูตรอาหารกลาง'
                  : lang === 'en'
                  ? 'Create New Central Base Recipe'
                  : 'สร้างสูตรอาหารกลางใหม่'}
              </h3>
              <button
                type="button"
                onClick={() => setIsBaseRecipeMetaModalOpen(false)}
                className="p-1 rounded-xl text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBaseRecipeMetaModal} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
                <div>
                  <label className="block text-white/80 font-bold mb-1">
                    {lang === 'en' ? 'Base Recipe Name (Thai)' : 'ชื่อสูตรอาหารกลาง (ไทย)'}{' '}
                    <span className="text-[#F27D26]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={
                      lang === 'en'
                        ? 'e.g. Classic Holy Basil Stir-fry Base'
                        : 'เช่น สูตรผัดกะเพรามาตรฐาน, สูตรข้าวผัดกลาง'
                    }
                    value={editingBaseRecipeMeta.name || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setBaseRecipeMetaError(null);
                      setEditingBaseRecipeMeta((prev) =>
                        prev ? { ...prev, name: nextTh, thaiName: nextTh } : prev
                      );
                      baseRecipeTranslationScheduler.schedule('baseRecipe', () => {
                        setEditingBaseRecipeMeta((prev) => {
                          if (!prev) return prev;
                          const currTh = prev.name || '';
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevBaseRecipeThaiRef.current,
                            nextThai: currTh,
                            currentEnglish: prev.englishName,
                            isManuallyEdited: Boolean(prev.englishNameManual),
                          });
                          prevBaseRecipeThaiRef.current = currTh;
                          return { ...prev, englishName: nextEn };
                        });
                      });
                    }}
                    onBlur={() => baseRecipeTranslationScheduler.flush('baseRecipe')}
                    className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-[#F27D26]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-white/80 font-bold">
                      {lang === 'en' ? 'Base Recipe Name (English)' : 'ชื่อสูตรอาหารกลาง (English)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        baseRecipeTranslationScheduler.cancel('baseRecipe');
                        prevBaseRecipeThaiRef.current = editingBaseRecipeMeta.name || '';
                        setEditingBaseRecipeMeta({
                          ...editingBaseRecipeMeta,
                          englishName: translateThaiToEnglish(editingBaseRecipeMeta.name || ''),
                          englishNameManual: false,
                        });
                      }}
                      className="text-[11px] font-bold text-[#F27D26] hover:underline cursor-pointer"
                    >
                      {lang === 'en' ? 'Re-translate from Thai' : 'แปลใหม่จากภาษาไทย'}
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder={
                      lang === 'en'
                        ? 'Auto-translated English recipe name'
                        : 'ชื่อภาษาอังกฤษ (แปลอัตโนมัติหรือแก้เองได้)'
                    }
                    value={editingBaseRecipeMeta.englishName || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      baseRecipeTranslationScheduler.cancel('baseRecipe');
                      setBaseRecipeMetaError(null);
                      setEditingBaseRecipeMeta({
                        ...editingBaseRecipeMeta,
                        englishName: val,
                        englishNameManual: Boolean(val.trim()),
                      });
                    }}
                    className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-amber-200 focus:outline-none focus:border-[#F27D26]"
                  />
                </div>

                {/* Link Rice & Noodles (Yield & Portions) */}
                <div className="p-3 rounded-2xl bg-[#FFC107]/10 border border-[#FFC107]/25 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-bold text-[#FFC107] flex items-center gap-1.5">
                      <Wheat className="w-3.5 h-3.5" />
                      <span>
                        {lang === 'en'
                          ? 'Link Rice & Noodles (Yield & Portions)'
                          : 'เชื่อมโยงหมวดข้าวและเส้น (Yield & Portions)'}
                      </span>
                    </label>
                  </div>
                  <select
                    value={editingBaseRecipeMeta.riceNoodlePortionId || ''}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setEditingBaseRecipeMeta((prev) =>
                        prev ? { ...prev, riceNoodlePortionId: nextId } : prev
                      );
                      const p = nextId ? riceNoodlePortionsMap.get(nextId) : undefined;
                      if (p) {
                        setBaseRecipeRiceNoodleQty(p.portionGram || 150);
                      }
                    }}
                    className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white cursor-pointer focus:border-[#FFC107]"
                  >
                    <option value="" className="bg-[#1a1a1a]">
                      {lang === 'en'
                        ? '-- None (No Rice / Noodles linked) --'
                        : '-- ไม่เชื่อมข้าวและเส้น --'}
                    </option>
                    {portionRecipes.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                        {lang === 'en' ? p.nameEn || p.name : p.name} ({p.portionGram}g · Yield {p.cookingYield} · ฿{Number(p.costPerPortion || 0).toFixed(2)})
                      </option>
                    ))}
                  </select>

                  {editingBaseRecipeMeta.riceNoodlePortionId && (() => {
                    const p = riceNoodlePortionsMap.get(editingBaseRecipeMeta.riceNoodlePortionId);
                    if (!p) return null;
                    const unitCost = p.portionGram > 0 ? p.costPerPortion / p.portionGram : 0;
                    const computedCost = (baseRecipeRiceNoodleQty > 0 ? baseRecipeRiceNoodleQty : 0) * unitCost;
                    return (
                      <div className="space-y-2 pt-1 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-white/80 font-semibold">
                            {lang === 'en' ? 'Weight used in recipe (g):' : 'ปริมาณที่ใช้ในสูตร (กรัม):'}
                          </label>
                          <NumericInput
                            type="number"
                            min="1"
                            step="any"
                            value={baseRecipeRiceNoodleQty}
                            onChange={(e) => setBaseRecipeRiceNoodleQty(parseFloat(e.target.value) || 0)}
                            className="w-24 p-1.5 bg-black/50 border border-white/20 rounded-lg text-right font-mono font-bold text-white focus:border-[#FFC107]"
                          />
                        </div>
                        <div className="flex items-center justify-between text-white/65">
                          <span>
                            {lang === 'en' ? 'Base:' : 'วัตถุดิบหลัก:'}{' '}
                            <strong className="text-white">
                              {lang === 'en' ? p.rawIngredientNameEn || p.rawIngredientName : p.rawIngredientName}
                            </strong>
                          </span>
                          <span className="text-emerald-400 font-mono">
                            Yield: {lang === 'en' ? p.cookingYieldEn || p.cookingYield : p.cookingYield}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-[#FFC107]/20 font-bold">
                          <span className="text-white/85">
                            {lang === 'en' ? 'Rice/Noodle Cost:' : 'ต้นทุนข้าวและเส้นในสูตร:'}
                          </span>
                          <span className="font-mono text-[#FFC107] text-xs">฿{computedCost.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {baseRecipeMetaError && (
                  <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-xl text-[11px] text-rose-300 font-semibold">
                    {baseRecipeMetaError}
                  </div>
                )}
              </div>

              <div className="modal-footer bg-[#1a1a1a] flex justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsBaseRecipeMetaModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-white font-semibold cursor-pointer"
                >
                  {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer"
                >
                  {baseRecipes.some((r) => r.id === editingBaseRecipeMeta.id)
                    ? lang === 'en'
                      ? 'Save Changes'
                      : 'บันทึกการแก้ไข'
                    : lang === 'en'
                    ? 'Create Base Recipe'
                    : 'สร้างสูตรอาหารกลาง'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CENTRAL BASE RECIPE CONFIRM MODAL */}
      {baseRecipeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="modal-panel bg-[#1a1a1a] rounded-3xl max-w-sm w-full shadow-2xl border border-white/20 text-white p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-white text-sm">
                  {lang === 'en' ? 'Delete Central Base Recipe?' : 'ยืนยันลบสูตรอาหารกลาง?'}
                </h3>
                <p className="text-white/65 leading-relaxed">
                  {lang === 'en'
                    ? `Delete "${getLocalizedText(lang, baseRecipeToDelete.thaiName || baseRecipeToDelete.name, baseRecipeToDelete.englishName)}"? Existing menu items will keep their current ingredient costs.`
                    : `ต้องการลบสูตร "${baseRecipeToDelete.name}" ใช่หรือไม่? (เมนูที่เคยเชื่อมไว้จะยังคงรายการวัตถุดิบปัจจุบันไว้)`}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBaseRecipeToDelete(null)}
                className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-white font-semibold cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteBaseRecipe}
                className="px-4 py-2 bg-rose-500 hover:bg-rose-600 rounded-xl text-white font-bold cursor-pointer"
              >
                {lang === 'en' ? 'Delete' : 'ลบสูตร'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT RICE & NOODLE PORTION MODAL */}
      {isPortionModalOpen && editingPortion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="modal-panel-fixed bg-[#1a1a1a] rounded-3xl max-w-lg w-full shadow-2xl border border-white/20 text-white">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h3 className="font-bold text-white text-base">
                {portionRecipes.some((p) => p.id === editingPortion.id)
                  ? lang === 'en'
                    ? 'Edit Rice & Noodle Recipe'
                    : 'แก้ไขสูตรข้าวและเส้น'
                  : lang === 'en'
                  ? 'Add Rice & Noodle Recipe'
                  : 'เพิ่มสูตรข้าวและเส้นใหม่'}
              </h3>
              <button
                type="button"
                onClick={() => setIsPortionModalOpen(false)}
                className="p-1 rounded-xl text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePortionModal} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-3.5 scrollbar-thin">
                {/* Type + Linked Stock Ingredient */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en' ? 'Category Type' : 'ประเภท'}
                    </label>
                    <select
                      value={editingPortion.type || 'ข้าว'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditingPortion((prev) =>
                          prev
                            ? {
                                ...prev,
                                type: val,
                                typeEn:
                                  val === 'ข้าว'
                                    ? 'Rice'
                                    : val === 'เส้น'
                                    ? 'Noodles'
                                    : translateThaiToEnglish(val),
                              }
                            : prev
                        );
                      }}
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white cursor-pointer focus:border-[#F27D26]"
                    >
                      <option value="ข้าว" className="bg-[#1a1a1a]">
                        {lang === 'en' ? 'Rice (ข้าว)' : 'ข้าว'}
                      </option>
                      <option value="เส้น" className="bg-[#1a1a1a]">
                        {lang === 'en' ? 'Noodles (เส้น)' : 'เส้น'}
                      </option>
                      <option value="อื่นๆ" className="bg-[#1a1a1a]">
                        {lang === 'en' ? 'Other' : 'อื่นๆ'}
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en'
                        ? 'Link to Stock Ingredient (Optional)'
                        : 'เชื่อมวัตถุดิบในคลัง (ไม่บังคับ)'}
                    </label>
                    <select
                      value={editingPortion.linkedIngredientId || ''}
                      onChange={(e) => handleLinkIngredientToPortion(e.target.value)}
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white cursor-pointer focus:border-[#F27D26]"
                    >
                      <option value="" className="bg-[#1a1a1a]">
                        {lang === 'en' ? '-- Custom / Not Linked --' : '-- กำหนดเอง / ไม่เชื่อม --'}
                      </option>
                      {riceAndNoodleIngredients.map((ing) => (
                        <option key={ing.id} value={ing.id} className="bg-[#1a1a1a]">
                          {getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Name TH & EN */}
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en' ? 'Recipe Name (Thai)' : 'ชื่อสูตรข้าว/เส้น (ไทย)'}{' '}
                      <span className="text-[#F27D26]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={
                        lang === 'en'
                          ? 'e.g. Steamed Jasmine Rice (200g)'
                          : 'เช่น ข้าวสวยหอมมะลิ (จานหลัก 200g)'
                      }
                      value={editingPortion.name || ''}
                      onChange={(e) => {
                        const nextTh = e.target.value;
                        setPortionFormError(null);
                        setEditingPortion((prev) => (prev ? { ...prev, name: nextTh } : prev));
                        portionTranslationScheduler.schedule('portion', () => {
                          setEditingPortion((prev) => {
                            if (!prev) return prev;
                            const currTh = prev.name || '';
                            const nextEn = computeAutoEnglishName({
                              previousThai: prevPortionThaiRef.current,
                              nextThai: currTh,
                              currentEnglish: prev.nameEn,
                              isManuallyEdited: false,
                            });
                            prevPortionThaiRef.current = currTh;
                            return { ...prev, nameEn: nextEn };
                          });
                        });
                      }}
                      onBlur={() => portionTranslationScheduler.flush('portion')}
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="block text-white/80 font-bold">
                        {lang === 'en' ? 'Recipe Name (English)' : 'ชื่อสูตร (English)'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          portionTranslationScheduler.cancel('portion');
                          prevPortionThaiRef.current = editingPortion.name || '';
                          setEditingPortion({
                            ...editingPortion,
                            nameEn: translateThaiToEnglish(editingPortion.name || ''),
                          });
                        }}
                        className="text-[11px] font-bold text-[#F27D26] hover:underline cursor-pointer"
                      >
                        {lang === 'en' ? 'Re-translate' : 'แปลใหม่จากไทย'}
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder={lang === 'en' ? 'English recipe name' : 'ชื่อภาษาอังกฤษ'}
                      value={editingPortion.nameEn || ''}
                      onChange={(e) => {
                        portionTranslationScheduler.cancel('portion');
                        setEditingPortion({ ...editingPortion, nameEn: e.target.value });
                      }}
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-amber-200 focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                </div>

                {/* Base Ingredient + Market Price */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en' ? 'Base Ingredient (TH)' : 'วัตถุดิบหลัก'}
                    </label>
                    <input
                      type="text"
                      placeholder={lang === 'en' ? 'e.g. Jasmine Rice' : 'เช่น ข้าวสารหอมมะลิ'}
                      value={editingPortion.rawIngredientName || ''}
                      onChange={(e) =>
                        setEditingPortion({ ...editingPortion, rawIngredientName: e.target.value })
                      }
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en' ? 'Market Price Label' : 'ราคาตลาด (แสดงในการ์ด)'}
                    </label>
                    <input
                      type="text"
                      placeholder={lang === 'en' ? 'e.g. ฿42 / kg' : 'เช่น ฿42 / กก.'}
                      value={editingPortion.rawPurchaseCost || ''}
                      onChange={(e) =>
                        setEditingPortion({
                          ...editingPortion,
                          rawPurchaseCost: e.target.value,
                          rawPurchaseCostEn: e.target.value,
                        })
                      }
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                </div>

                {/* Serving grams, Yield, Cost per dish */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en' ? 'Serving Size (g)' : 'ขนาดเสิร์ฟ (กรัม)'}{' '}
                      <span className="text-[#F27D26]">*</span>
                    </label>
                    <NumericInput
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={editingPortion.portionGram ?? 150}
                      onChange={(e) => {
                        const gram = parseFloat(e.target.value) || 0;
                        setPortionFormError(null);
                        setEditingPortion((prev) => {
                          if (!prev) return prev;
                          let nextCost = prev.costPerPortion;
                          const linked = prev.linkedIngredientId
                            ? ingredientsMap.get(prev.linkedIngredientId)
                            : undefined;
                          if (linked && gram > 0) {
                            const conv = convertUnit(gram, 'g', linked.usageUnit || linked.baseUnit || 'g');
                            const eff = conv.success ? conv.convertedQuantity : gram;
                            nextCost = Number(((linked.costPerBaseUnit || 0) * eff).toFixed(2));
                          }
                          return { ...prev, portionGram: gram, costPerPortion: nextCost };
                        });
                      }}
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-mono font-bold text-white focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en' ? 'Cooking Yield' : 'Yield การหุง/ลวก'}
                    </label>
                    <input
                      type="text"
                      placeholder="100%"
                      value={editingPortion.cookingYield || ''}
                      onChange={(e) =>
                        setEditingPortion({
                          ...editingPortion,
                          cookingYield: e.target.value,
                          cookingYieldEn: e.target.value,
                        })
                      }
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-mono font-bold text-emerald-400 focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-white/80 font-bold mb-1">
                      {lang === 'en' ? 'Cost / Dish (฿)' : 'ต้นทุนต่อจาน (฿)'}{' '}
                      <span className="text-[#F27D26]">*</span>
                    </label>
                    <NumericInput
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={editingPortion.costPerPortion ?? 0}
                      onChange={(e) => {
                        setPortionFormError(null);
                        setEditingPortion({
                          ...editingPortion,
                          costPerPortion: parseFloat(e.target.value) || 0,
                        });
                      }}
                      className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl font-mono font-bold text-[#FFC107] focus:border-[#F27D26]"
                    />
                  </div>
                </div>

                {/* Dishes using (comma separated) */}
                <div>
                  <label className="block text-white/80 font-bold mb-1">
                    {lang === 'en'
                      ? 'Used in Dishes (comma-separated, optional)'
                      : 'เมนูที่ใช้ (คั่นด้วยเครื่องหมายจุลภาค , ไม่บังคับ)'}
                  </label>
                  <input
                    type="text"
                    placeholder={
                      lang === 'en'
                        ? 'e.g. All Holy Basil Dishes, Garlic Pork'
                        : 'เช่น กะเพราทุกเมนู, หมูกระเทียม'
                    }
                    value={(editingPortion.dishesUsing || []).join(', ')}
                    onChange={(e) => {
                      const list = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setEditingPortion({
                        ...editingPortion,
                        dishesUsing: list,
                        dishesUsingEn: list,
                      });
                    }}
                    className="w-full p-2.5 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-[#F27D26]"
                  />
                </div>

                {portionFormError && (
                  <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-xl text-[11px] text-rose-300 font-semibold">
                    {portionFormError}
                  </div>
                )}
              </div>

              <div className="modal-footer bg-[#1a1a1a] flex justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsPortionModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-white font-semibold cursor-pointer"
                >
                  {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer"
                >
                  {portionRecipes.some((p) => p.id === editingPortion.id)
                    ? lang === 'en'
                      ? 'Save Recipe'
                      : 'บันทึกการแก้ไข'
                    : lang === 'en'
                    ? 'Add Recipe'
                    : 'เพิ่มสูตรข้าว/เส้น'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE RICE & NOODLE PORTION CONFIRM MODAL */}
      {portionToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="modal-panel bg-[#1a1a1a] rounded-3xl max-w-sm w-full shadow-2xl border border-white/20 text-white p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-white text-sm">
                  {lang === 'en' ? 'Delete Rice / Noodle Recipe?' : 'ยืนยันลบสูตรข้าวและเส้น?'}
                </h3>
                <p className="text-white/65 leading-relaxed">
                  {lang === 'en'
                    ? `Delete "${portionToDelete.nameEn || portionToDelete.name}"?`
                    : `ต้องการลบสูตร "${portionToDelete.name}" ใช่หรือไม่?`}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPortionToDelete(null)}
                className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-xl text-white font-semibold cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePortion}
                className="px-4 py-2 bg-rose-500 hover:bg-rose-600 rounded-xl text-white font-bold cursor-pointer"
              >
                {lang === 'en' ? 'Delete' : 'ลบสูตร'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
