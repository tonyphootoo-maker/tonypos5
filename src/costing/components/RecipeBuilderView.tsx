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
  Edit2,
  X,
  Package,
  Soup,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import { resolveCentralRecipeMenuTarget } from '../utils/centralRecipeNav';
import {
  MenuItem,
  MenuVariant,
  Ingredient,
  Sauce,
  RecipeItem,
  SauceRecipeItem,
  RestaurantSettings,
  PackagingLineItem,
  UnitType,
} from '../types';
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

// Helper to determine if a recipe line item is a variant's protein/meat
const isProteinItem = (it: RecipeItem, proteinType?: string): boolean => {
  if (
    it.proteinCategory === 'SHRIMP' ||
    it.proteinCategory === 'SQUID' ||
    it.proteinCategory === 'PORK' ||
    it.proteinCategory === 'CHICKEN' ||
    it.proteinCategory === 'BEEF' ||
    it.proteinCategory === 'OTHER'
  ) {
    return true;
  }

  if (
    it.type === 'SAUCE' ||
    it.ingredientType === 'SAUCE' ||
    it.type === 'PACKAGING' ||
    it.ingredientType === 'PACKAGING' ||
    it.type === 'PREPARED_ITEM' ||
    it.ingredientType === 'PREPARED_ITEM'
  ) {
    return false;
  }

  const name = (it.name || '').trim().toLowerCase();

  // Exclude seasonings and base ingredients even if their name contains words like ปลา, ไก่, หมู
  if (
    name.includes('น้ำปลา') ||
    name.includes('น้ำมัน') ||
    name.includes('ซอส') ||
    name.includes('ผง') ||
    name.includes('ซีอิ๊ว') ||
    name.includes('กะปิ') ||
    name.includes('กุ้งแห้ง') ||
    name.includes('ใบ') ||
    name.includes('พริก') ||
    name.includes('กระเทียม') ||
    name.includes('หอม') ||
    name.includes('ไข่') ||
    name.includes('ผัก') ||
    name.includes('น้ำตาล') ||
    name.includes('เกลือ') ||
    name.includes('ข้าว')
  ) {
    return false;
  }

  // Specific raw protein identifiers
  if (
    name.includes('หมูหมัก') ||
    name.includes('หมูบด') ||
    name.includes('หมูสับ') ||
    name.includes('หมูกรอบ') ||
    name.includes('เนื้อไก่') ||
    name.includes('อกไก่') ||
    name.includes('สะโพกไก่') ||
    name.includes('ไก่ชิ้น') ||
    name.includes('เนื้อวัว') ||
    name.includes('เนื้อสับ') ||
    name.includes('เนื้อสไลซ์') ||
    name.includes('กุ้งสด') ||
    name.includes('ปลาหมึก') ||
    name.includes('ไส้กรอก') ||
    name.includes('เนื้อปลา')
  ) {
    return true;
  }

  if (proteinType && proteinType.trim()) {
    const pType = proteinType.trim().toLowerCase();
    if (name === pType || name.startsWith(pType)) {
      return true;
    }
  }

  return false;
};

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
}

export const RecipeBuilderView: React.FC<RecipeBuilderViewProps> = ({
  menus,
  ingredients,
  sauces,
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
}) => {
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

  // --- TAB 1: CENTRAL BASE RECIPES (คลังสูตรอาหารกลาง) ---
  const [selectedMenuId, setSelectedMenuId] = useState<string>(() => {
    const resolved = resolveCentralRecipeMenuTarget(menus, {
      variantId: initialVariantId,
      menuId: initialMenuId,
    });
    if (resolved) return resolved.menu.id;
    return menus[0]?.id || '';
  });

  const currentMenu = useMemo(() => {
    return menus.find((m) => m.id === selectedMenuId) || menus[0];
  }, [menus, selectedMenuId]);

  const [localBaseItems, setLocalBaseItems] = useState<RecipeItem[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const [showReturnUnsavedConfirm, setShowReturnUnsavedConfirm] = useState(false);
  const lastLoadedMenuIdRef = useRef<string>('');
  const appliedTargetKeyRef = useRef<string | null>(null);
  const onTargetAppliedRef = useRef(onTargetApplied);
  onTargetAppliedRef.current = onTargetApplied;

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
      setSelectedMenuId(resolved.menu.id);
      setActiveTab('FOOD');
      setShowReturnUnsavedConfirm(false);
      onTargetAppliedRef.current?.();
    }
  }, [initialVariantId, initialMenuId, targetNonce, menus]);

  // Load base items whenever selectedMenuId changes
  useEffect(() => {
    if (currentMenu) {
      const isSwitchingMenu = lastLoadedMenuIdRef.current !== currentMenu.id;
      // Do not overwrite user's unsaved edits if staying on the same menu
      if (!isSwitchingMenu && hasUnsavedChanges) {
        return;
      }

      if (isSwitchingMenu) {
        lastLoadedMenuIdRef.current = currentMenu.id;
      }

      const firstVariant = currentMenu.variants[0];
      const seenItemIds = new Set<string>();
      const items: RecipeItem[] = [];

      if (firstVariant && firstVariant.recipeItems && firstVariant.recipeItems.length > 0) {
        firstVariant.recipeItems.forEach((it, idx) => {
          if (!isProteinItem(it, firstVariant.proteinType)) {
            const safeId = it.id || `item_${idx}_${it.ingredientId}`;
            const isDuplicate = seenItemIds.has(safeId);
            if (!isDuplicate) {
              seenItemIds.add(safeId);
              items.push({ ...it, id: safeId });
            }
          }
        });
      }

      // If packaging items exist on variant and not yet in items as PACKAGING:
      if (firstVariant?.packagingItems && firstVariant.packagingItems.length > 0) {
        firstVariant.packagingItems.forEach((pkg) => {
          if (!items.some((it) => it.name === pkg.name)) {
            items.push({
              id: `pkg_${pkg.id}`,
              type: 'PACKAGING',
              ingredientType: 'PACKAGING',
              ingredientId: pkg.id,
              name: pkg.name,
              quantity: 1,
              unit: 'ชิ้น',
              calculatedUnitCost: pkg.cost,
              calculatedLineCost: pkg.cost,
            });
          }
        });
      } else if (
        (!firstVariant?.recipeItems || firstVariant.recipeItems.length === 0) &&
        !items.some((it) => it.type === 'PACKAGING' || it.ingredientType === 'PACKAGING')
      ) {
        items.push({
          id: `pkg_default_box`,
          type: 'PACKAGING',
          ingredientType: 'PACKAGING',
          ingredientId: 'pkg_kraft_box',
          name: 'กล่องกระดาษคราฟท์อาหารรักษ์โลก',
          quantity: 1,
          unit: 'ชิ้น',
          calculatedUnitCost: 2.50,
          calculatedLineCost: 2.50,
        });
      }

      // Only set localBaseItems if switching to a new menu or initially empty
      if (isSwitchingMenu || localBaseItems.length === 0) {
        setLocalBaseItems(items);
        setHasUnsavedChanges(false);
      }
    }
  }, [selectedMenuId, currentMenu, hasUnsavedChanges, localBaseItems.length]);

  // Calculate unit cost and line cost for each item with unit conversion
  const getItemCost = (item: RecipeItem) => {
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

  const totalBaseIngredientsCost = useMemo(() => {
    return localBaseItems
      .filter((it) => it.type === 'INGREDIENT' || (!it.type && it.ingredientType !== 'SAUCE' && it.ingredientType !== 'PACKAGING' && it.ingredientType !== 'PREPARED_ITEM'))
      .reduce((sum, it) => sum + getItemCost(it).lineCost, 0);
  }, [localBaseItems, ingredientsMap, saucesMap]);

  const totalSauceCost = useMemo(() => {
    return localBaseItems
      .filter((it) => it.type === 'SAUCE' || it.ingredientType === 'SAUCE')
      .reduce((sum, it) => sum + getItemCost(it).lineCost, 0);
  }, [localBaseItems, ingredientsMap, saucesMap]);

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

  const totalBaseRecipeCost =
    totalBaseIngredientsCost + totalSauceCost + totalSideDishCost + totalPackagingCost;

  const handleRemoveBaseItemById = (itemId: string) => {
    const updated = localBaseItems.filter((it) => it.id !== itemId);
    setLocalBaseItems(updated);
    setHasUnsavedChanges(true);
  };

  const handleUpdateBaseItemSourceById = (itemId: string, newSourceId: string) => {
    const updated = localBaseItems.map((current) => {
      if (current.id !== itemId) return current;
      const clone = { ...current };
      if (clone.type === 'SAUCE') {
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

  const handleSaveBaseRecipe = () => {
    if (!currentMenu) return;

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

    const updatedVariants = currentMenu.variants.map((v) => {
      // Keep protein item(s) from existing variant
      const proteinItems = (v.recipeItems || []).filter((it) =>
        isProteinItem(it, v.proteinType)
      );

      // If no protein items matched, fallback to keeping the first item only if not already in enrichedBaseItems
      let finalProteins = proteinItems;
      if (finalProteins.length === 0 && v.recipeItems && v.recipeItems.length > 0) {
        const candidate = v.recipeItems[0];
        const alreadyInBase = enrichedBaseItems.some(
          (b) => b.id === candidate.id || b.name === candidate.name
        );
        if (!alreadyInBase && isProteinItem(candidate, v.proteinType)) {
          finalProteins = [candidate];
        }
      }

      // Ensure every item in combinedRecipeItems has a unique ID
      const seenVariantItemIds = new Set<string>();
      const combinedRecipeItems: RecipeItem[] = [];

      for (const item of [...finalProteins, ...enrichedBaseItems]) {
        let itemId = item.id;
        if (!itemId || seenVariantItemIds.has(itemId)) {
          itemId = `${itemId || 'item'}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        }
        seenVariantItemIds.add(itemId);
        combinedRecipeItems.push({
          ...item,
          id: itemId,
        });
      }

      return {
        ...v,
        recipeItems: combinedRecipeItems,
        packagingCost: packagingCost,
        packagingItems: packagingItems,
      };
    });

    const updatedMenu: MenuItem = {
      ...currentMenu,
      variants: updatedVariants,
      updatedAt: new Date().toISOString(),
    };

    if (onSaveMenu) {
      onSaveMenu(updatedMenu);
    } else if (onSaveVariantRecipe) {
      updatedVariants.forEach((v) => {
        onSaveVariantRecipe(currentMenu.id, v.id, v.recipeItems);
      });
    }

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

  // Standard portion mapping for Tony's Kitchen
  const standardPortions = [
    {
      id: 'portion_rice',
      name: 'ข้าวสวยหอมมะลิ (จานหลัก 200g)',
      nameEn: 'Steamed Jasmine Rice (Main Dish 200g)',
      type: 'ข้าว',
      typeEn: 'Rice',
      rawIngredientName: 'ข้าวสารหอมมะลิ',
      rawIngredientNameEn: 'Jasmine Rice (Uncooked)',
      rawPurchaseCost: '฿42 / กก.',
      rawPurchaseCostEn: '฿42 / kg',
      cookingYield: '220% (ขยาย 2.2 เท่า)',
      cookingYieldEn: '220% (2.2x expansion)',
      portionGram: 200,
      costPerPortion: 8.67,
      dishesUsing: ['กะเพราทุกเมนู', 'หมูกระเทียม', 'ไก่ผัดพริกเผา'],
      dishesUsingEn: ['All Holy Basil Dishes', 'Garlic Pork', 'Roasted Chili Paste Chicken'],
    },
    {
      id: 'portion_padthai',
      name: 'เส้นจันท์แช่น้ำ (ผัดไทย 150g)',
      nameEn: 'Soaked Chantaburi Rice Noodles (Pad Thai 150g)',
      type: 'เส้น',
      typeEn: 'Noodles',
      rawIngredientName: 'เส้นจันท์แห้ง',
      rawIngredientNameEn: 'Dried Rice Noodles',
      rawPurchaseCost: '฿55 / กก.',
      rawPurchaseCostEn: '฿55 / kg',
      cookingYield: '100% (แช่น้ำพร้อมผัด)',
      cookingYieldEn: '100% (Soaked & ready to stir-fry)',
      portionGram: 150,
      costPerPortion: 8.25,
      dishesUsing: ['ผัดไทยกุ้งสด', 'ผัดไทยโบราณ', 'ผัดไทยทะเล'],
      dishesUsingEn: ['Pad Thai Shrimp', 'Classic Pad Thai', 'Pad Thai Seafood'],
    },
    {
      id: 'portion_flat',
      name: 'เส้นใหญ่สด (ผัดซีอิ๊ว/คั่วไก่ 180g)',
      nameEn: 'Fresh Wide Rice Noodles (Pad See Ew 180g)',
      type: 'เส้น',
      typeEn: 'Noodles',
      rawIngredientName: 'เส้นใหญ่ตลาด',
      rawIngredientNameEn: 'Fresh Flat Noodles',
      rawPurchaseCost: '฿35 / กก.',
      rawPurchaseCostEn: '฿35 / kg',
      cookingYield: '100% (คลี่เส้นพร้อมผัด)',
      cookingYieldEn: '100% (Separated & ready)',
      portionGram: 180,
      costPerPortion: 6.30,
      dishesUsing: ['ผัดซีอิ๊วหมู', 'ก๋วยเตี๋ยวคั่วไก่', 'ราดหน้า'],
      dishesUsingEn: ['Pad See Ew Pork', 'Kuay Teow Kua Gai', 'Rad Na'],
    },
    {
      id: 'portion_mama',
      name: 'บะหมี่กึ่งสำเร็จรูป (มาม่า 1 ซอง 60g)',
      nameEn: 'Instant Noodles (1 Pack 60g)',
      type: 'เส้น',
      typeEn: 'Noodles',
      rawIngredientName: 'มาม่าแพ็ค',
      rawIngredientNameEn: 'Instant Noodle Pack',
      rawPurchaseCost: '฿6.00 / ซอง',
      rawPurchaseCostEn: '฿6.00 / pack',
      cookingYield: '100% (ลวกสุก)',
      cookingYieldEn: '100% (Blanched)',
      portionGram: 60,
      costPerPortion: 6.00,
      dishesUsing: ['มาม่าผัดขี้เมา', 'ต้มยำมาม่าหม้อไฟ', 'ยำมาม่ารวมมิตร'],
      dishesUsingEn: ['Drunken Stir-Fried Mama', 'Tom Yum Mama Hot Pot', 'Spicy Mama Salad'],
    },
    {
      id: 'portion_glass',
      name: 'วุ้นเส้นสด (อบหม้อดิน/ผัด 100g)',
      nameEn: 'Fresh Glass Noodles (100g)',
      type: 'เส้น',
      typeEn: 'Noodles',
      rawIngredientName: 'วุ้นเส้นสดเกรด A',
      rawIngredientNameEn: 'Fresh Grade-A Glass Noodles',
      rawPurchaseCost: '฿65 / กก.',
      rawPurchaseCostEn: '฿65 / kg',
      cookingYield: '100% (แช่น้ำ)',
      cookingYieldEn: '100% (Soaked)',
      portionGram: 100,
      costPerPortion: 6.50,
      dishesUsing: ['กุ้งอบวุ้นเส้น', 'ยำวุ้นเส้นโบราณ', 'ต้มจืดวุ้นเส้น'],
      dishesUsingEn: ['Baked Shrimp with Glass Noodles', 'Spicy Glass Noodle Salad', 'Clear Glass Noodle Soup'],
    },
  ];

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
          {/* Base Recipe Selector Bar */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-4 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 flex-wrap">
              <span className="text-xs font-bold text-white/60 whitespace-nowrap">
                {lang === 'en' ? 'Select Base Recipe:' : 'เลือกสูตรอาหารกลาง (Base Recipe):'}
              </span>
              <select
                value={selectedMenuId}
                onChange={(e) => setSelectedMenuId(e.target.value)}
                className="bg-black/50 border border-white/15 px-3 py-2 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-[#F27D26] max-w-md cursor-pointer"
              >
                {menus.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#1a1a1a]">
                    {lang === 'en'
                      ? `Recipe: ${getLocalizedText(lang, m.thaiName || m.name, m.englishName)}`
                      : `สูตร ${m.name}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-xs text-amber-400 font-semibold animate-pulse">
                  ● {lang === 'en' ? 'Unsaved changes' : 'มีการแก้ไขที่ยังไม่ได้บันทึก'}
                </span>
              )}
              {saveSuccessNotice && (
                <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {lang === 'en'
                      ? 'Base recipe saved & synced to all protein options'
                      : 'บันทึกสูตรกลางและซิงค์ตัวเลือกเนื้อสัตว์เรียบร้อยแล้ว'}
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={handleSaveBaseRecipe}
                disabled={!hasUnsavedChanges}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  hasUnsavedChanges
                    ? 'bg-[#F27D26] hover:bg-[#d96817] text-black shadow-lg shadow-[#F27D26]/20'
                    : 'bg-white/10 text-white/40 cursor-not-allowed'
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {lang === 'en'
                    ? 'Save Base Recipe (Sync to All Options)'
                    : 'บันทึกสูตรอาหารกลาง (Sync ไปทุกเนื้อสัตว์)'}
                </span>
              </button>
            </div>
          </div>

          {/* Main Grid: Recipe Builder Left, Live Breakdown Right */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left: Central Recipe Items Builder (2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              {/* Card 1: Central Recipe Ingredients & Sauces */}
              <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/10 gap-2">
                  <h3 className="font-bold text-white text-base">
                    {lang === 'en'
                      ? `Base Recipe Items (${nonPackagingItems.length} items)`
                      : `รายการส่วนประกอบในสูตรกลาง (${nonPackagingItems.length} รายการ)`}
                  </h3>

                  {/* 2 Add buttons: วัตถุดิบ, ซอสปรุง */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={handleAddBaseIngredient}
                      className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                      title={lang === 'en' ? 'Add base ingredient e.g. chili, garlic, holy basil, cooking oil' : 'เพิ่มวัตถุดิบกลาง เช่น พริก, กระเทียม, ใบกะเพรา, น้ำมัน'}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{lang === 'en' ? '+ Base Ingredient' : '+ วัตถุดิบกลาง'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddSauce}
                      className="px-2.5 py-1.5 rounded-xl bg-[#F27D26]/20 hover:bg-[#F27D26]/30 text-[#F27D26] text-xs font-bold flex items-center gap-1 cursor-pointer border border-[#F27D26]/30 transition-colors"
                      title={lang === 'en' ? 'Add batch-prepared sauce' : 'เพิ่มซอสปรุงรสที่เตรียมล่วงหน้าเป็น Batch'}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{lang === 'en' ? '+ Sauce' : '+ ซอสปรุง'}</span>
                    </button>
                  </div>
                </div>

                {/* Items Table */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-white/50 text-[10px] uppercase">
                        <th className="py-2.5 px-3">{lang === 'en' ? 'Recipe Item' : 'ชื่อรายการในสูตร'}</th>
                        <th className="py-2.5 px-3 text-right">{lang === 'en' ? 'Qty' : 'ปริมาณ'}</th>
                        <th className="py-2.5 px-3">{lang === 'en' ? 'Unit' : 'หน่วย'}</th>
                        <th className="py-2.5 px-3 text-right">{lang === 'en' ? 'Cost/Unit' : 'ต้นทุน/หน่วย'}</th>
                        <th className="py-2.5 px-3 text-right">{lang === 'en' ? 'Total (฿)' : 'รวมเงิน (฿)'}</th>
                        <th className="py-2.5 px-2 text-center">{lang === 'en' ? 'Del' : 'ลบ'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {nonPackagingItems.map((item, index) => {
                        const costInfo = getItemCost(item);

                        return (
                          <tr key={`${item.id || 'item'}-${index}`} className="hover:bg-white/5 transition-colors">
                            <td className="py-2.5 px-3 font-sans font-medium text-white">
                              {item.type === 'SAUCE' ? (
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
                                  {/* Step 1: Select Category first */}
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
                                    className="bg-black/60 border border-white/20 rounded-lg px-2 py-1 text-[11px] text-[#F27D26] font-bold cursor-pointer shrink-0 max-w-[130px]"
                                    title={lang === 'en' ? '1. Select ingredient category first' : '1. เลือกหมวดหมู่วัตถุดิบก่อน'}
                                  >
                                    <option value="ALL">{lang === 'en' ? '📁 All Categories' : '📁 ทุกหมวด'}</option>
                                    {uniqueCategories.map((cat) => (
                                      <option key={cat} value={cat} className="bg-[#1a1a1a] text-white">
                                        {getCategoryIcon(cat)} {getLocalizedText(lang, cat)}
                                      </option>
                                    ))}
                                  </select>

                                  {/* Step 2: Select Sub-ingredient */}
                                  {(() => {
                                    const selectedCat = (item.id && baseItemCategoryOverrides[item.id]) || ingredientsMap.get(item.ingredientId)?.category || 'ALL';
                                    const categoryIngs = selectedCat === 'ALL'
                                      ? ingredients
                                      : ingredients.filter((i) => i.category === selectedCat);

                                    return (
                                      <select
                                        value={item.ingredientId}
                                        onChange={(e) => handleUpdateBaseItemSourceById(item.id || '', e.target.value)}
                                        className="bg-black/50 border border-white/15 rounded-lg px-2 py-1 text-xs text-white max-w-[190px] cursor-pointer"
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

                            <td className="py-2.5 px-3 text-right">
                              <NumericInput
                                type="number"
                                step="any"
                                min="0"
                                value={item.quantity ?? 0}
                                onChange={(e) =>
                                  handleUpdateBaseItemQuantityById(item.id || '', parseFloat(e.target.value) || 0)
                                }
                                className="w-20 p-1 bg-black/40 border border-white/20 rounded-lg text-right text-white font-mono font-bold focus:border-[#F27D26]"
                              />
                            </td>

                            <td className="py-2.5 px-3 font-sans text-white/50 text-[11px]">
                              {localizeUnit(item.unit, lang)}
                            </td>

                            <td className="py-2.5 px-3 text-right text-white/60">
                              <div className="flex flex-col items-end">
                                <span>฿{costInfo.unitCost.toFixed(costInfo.unitCost < 1 ? 4 : 2)}</span>
                                {costInfo.missingPrice && (
                                  <span className="mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                                    {lang === 'en'
                                      ? 'Missing ingredient price — cost may be understated'
                                      : 'ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง'}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-2.5 px-3 text-right font-bold text-white">
                              ฿{costInfo.lineCost.toFixed(2)}
                            </td>

                            <td className="py-2.5 px-2 text-center">
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
              </div>

              {/* Card 2: Dedicated Packaging & Side Dish Items Card (ต้นทุนกล่อง & บรรจุภัณฑ์) */}
              <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/10 gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-[#00B1FF]/20 text-[#00B1FF] flex items-center justify-center border border-[#00B1FF]/30">
                      <Package className="w-4 h-4" />
                    </div>
                    <h3 className="font-bold text-white text-base">
                      {lang === 'en'
                        ? `Box & Packaging Costs (${packagingAndSideItems.length} items)`
                        : `ต้นทุนกล่อง & บรรจุภัณฑ์ (Packaging Items) (${packagingAndSideItems.length} รายการ)`}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    <button
                      type="button"
                      onClick={handleAddSideDish}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-1 cursor-pointer border border-amber-500/30 transition-colors"
                      title={lang === 'en' ? 'Add side dishes e.g. chili fish sauce, cucumber, rice, fried egg' : 'เพิ่มเครื่องเคียง เช่น พริกน้ำปลา, แตงกวาเคียง, ข้าวสวย, ไข่ดาว'}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{lang === 'en' ? '+ Side Dish' : '+ เครื่องเคียง'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddPackaging}
                      className="px-3 py-1.5 rounded-xl bg-[#00B1FF]/20 hover:bg-[#00B1FF]/30 text-[#00B1FF] border border-[#00B1FF]/40 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                      title={lang === 'en' ? 'Add packaging e.g. kraft box, cutlery set, sauce cup, bag' : 'เพิ่มบรรจุภัณฑ์ เช่น กล่องกระดาษคราฟท์, ช้อนส้อม, ถ้วยน้ำจิ้ม, ถุงหูหิ้ว'}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{lang === 'en' ? '+ Packaging' : '+ แพ็คเกจจิ้ง'}</span>
                    </button>
                  </div>
                </div>

                {packagingAndSideItems.length === 0 ? (
                  <div className="p-4 text-center text-white/40 text-xs border border-dashed border-white/10 rounded-2xl">
                    {lang === 'en'
                      ? 'No packaging or side dish items for this menu yet (click "+ Side Dish" or "+ Packaging" above to add)'
                      : 'ยังไม่มีรายการกล่องหรือเครื่องเคียงสำหรับเมนูนี้ (กดปุ่ม "+ เครื่องเคียง" หรือ "+ แพ็คเกจจิ้ง" ด้านบนเพื่อเพิ่ม)'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-white/10 text-white/50 text-[10px] uppercase">
                          <th className="py-2.5 px-3">{lang === 'en' ? 'Packaging / Side Dish Item' : 'รายการบรรจุภัณฑ์ / เครื่องเคียง'}</th>
                          <th className="py-2.5 px-3 text-right">{lang === 'en' ? 'Qty' : 'จำนวน'}</th>
                          <th className="py-2.5 px-3">{lang === 'en' ? 'Unit' : 'หน่วย'}</th>
                          <th className="py-2.5 px-3 text-right">{lang === 'en' ? 'Cost/Unit' : 'ต้นทุน/หน่วย'}</th>
                          <th className="py-2.5 px-3 text-right">{lang === 'en' ? 'Total (฿)' : 'รวมเงิน (฿)'}</th>
                          <th className="py-2.5 px-2 text-center">{lang === 'en' ? 'Del' : 'ลบ'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono">
                        {packagingAndSideItems.map((item, index) => {
                          const costInfo = getItemCost(item);

                          return (
                            <tr key={`${item.id || 'pkg'}-${index}`} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 px-3 font-sans font-medium text-white">
                                {item.type === 'PREPARED_ITEM' ? (
                                  <select
                                    value={item.ingredientId}
                                    onChange={(e) => handleUpdateBaseItemSourceById(item.id || '', e.target.value)}
                                    className="bg-black/50 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white max-w-[260px] cursor-pointer"
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
                                    className="bg-black/50 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white max-w-[260px] cursor-pointer"
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

                              <td className="py-2.5 px-3 text-right">
                                <NumericInput
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={item.quantity ?? 1}
                                  onChange={(e) =>
                                    handleUpdateBaseItemQuantityById(item.id || '', parseFloat(e.target.value) || 0)
                                  }
                                  className="w-16 p-1 bg-black/40 border border-white/20 rounded-lg text-right text-white font-mono font-bold focus:border-[#00B1FF]"
                                />
                              </td>

                              <td className="py-2.5 px-3 font-sans text-white/50 text-[11px]">
                                {localizeUnit(item.unit || 'ชิ้น', lang)}
                              </td>

                              <td className="py-2.5 px-3 text-right text-white/60">
                                ฿{costInfo.unitCost.toFixed(2)}
                              </td>

                              <td className="py-2.5 px-3 text-right font-bold text-[#00B1FF]">
                                ฿{costInfo.lineCost.toFixed(2)}
                              </td>

                              <td className="py-2.5 px-2 text-center">
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

                    <div className="flex justify-between items-center px-4 py-2.5 bg-[#00B1FF]/10 border border-[#00B1FF]/20 rounded-xl text-xs font-mono mt-3">
                      <span className="font-sans text-white/70 font-semibold flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5 text-[#00B1FF]" />
                        <span>
                          {lang === 'en'
                            ? 'Total Packaging & Side Dish Cost:'
                            : 'รวมต้นทุนกล่อง บรรจุภัณฑ์ และเครื่องเคียง:'}
                        </span>
                      </span>
                      <span className="font-bold text-[#00B1FF] text-sm">
                        ฿{(totalPackagingCost + totalSideDishCost).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Central Recipe Costing Breakdown Card */}
            <div className="space-y-4">
              <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-5 space-y-4">
                <div>
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider block">
                    {lang === 'en' ? 'Base Recipe Cost Breakdown' : 'คลังสูตรอาหารกลาง (Base Recipe Cost)'}
                  </span>
                  <h3 className="font-bold text-white text-base mt-0.5">
                    {lang === 'en'
                      ? `Recipe: ${getLocalizedText(lang, currentMenu?.thaiName || currentMenu?.name || '', currentMenu?.englishName)}`
                      : `สูตร ${currentMenu?.name}`}
                  </h3>
                </div>

                {/* Breakdown per category */}
                <div className="space-y-2 text-xs font-mono bg-black/30 p-3 rounded-2xl border border-white/10">
                  <div className="flex justify-between text-white/70">
                    <span className="font-sans flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>{lang === 'en' ? 'Base Ingredients:' : 'วัตถุดิบกลาง:'}</span>
                    </span>
                    <span className="text-white font-bold">฿{totalBaseIngredientsCost.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-white/70">
                    <span className="font-sans flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#F27D26]" />
                      <span>{lang === 'en' ? 'Seasoning Sauces:' : 'ซอสปรุงรส:'}</span>
                    </span>
                    <span className="text-white font-bold">฿{totalSauceCost.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-white/70">
                    <span className="font-sans flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      <span>{lang === 'en' ? 'Side Dishes:' : 'เครื่องเคียง:'}</span>
                    </span>
                    <span className="text-white font-bold">฿{totalSideDishCost.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-white/70">
                    <span className="font-sans flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-400" />
                      <span>{lang === 'en' ? 'Packaging:' : 'บรรจุภัณฑ์ (แพ็คเกจจิ้ง):'}</span>
                    </span>
                    <span className="text-white font-bold">฿{totalPackagingCost.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between pt-2 border-t border-white/10 font-bold text-sm">
                    <span className="font-sans text-white">
                      {lang === 'en' ? 'Total Base Recipe Cost:' : 'รวมต้นทุนสูตรกลาง:'}
                    </span>
                    <span className="text-[#FFC107]">
                      ฿{totalBaseRecipeCost.toFixed(2)} / {lang === 'en' ? 'dish' : 'จาน'}
                    </span>
                  </div>
                </div>

                {/* Synced Variants List */}
                <div className="pt-2 border-t border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      {lang === 'en'
                        ? `Protein Options in Recipe (${currentMenu?.variants.length || 0} options)`
                        : `ตัวเลือกเนื้อสัตว์ในสูตรนี้ (${currentMenu?.variants.length || 0} ตัวเลือก)`}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-thin pr-1">
                    {currentMenu?.variants.map((v) => (
                      <div
                        key={v.id}
                        className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold">
                            {getLocalizedText(lang, v.thaiName || v.proteinType || v.name, v.englishName)}
                          </span>
                          {v.proteinType === 'ทะเล' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">
                              {lang === 'en' ? 'Shrimp + Squid' : 'กุ้ง + หมึก'}
                            </span>
                          )}
                        </div>
                        <span className="text-white/60 font-mono">฿{v.sellingPrice}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-white/5 p-2.5 rounded-xl text-[10px] text-white/50 leading-relaxed">
                    💡{' '}
                    {lang === 'en' ? (
                      <>
                        Clicking <strong>Save Base Recipe</strong> syncs these ingredients, sauces, side dishes, and packaging across all protein options while preserving each option's meat portioning.
                      </>
                    ) : (
                      <>
                        เมื่อกด <strong>บันทึกสูตรอาหารกลาง</strong> ระบบจะนำวัตถุดิบ ซอส เครื่องเคียง และแพ็คเกจจิ้งข้างต้นไปอัปเดตให้กับทุกตัวเลือกเนื้อสัตว์ทันที โดยยังคงพอร์ชั่นเนื้อสัตว์ของแต่ละตัวเลือกไว้
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
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
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-3xl">
            <div className="flex items-center gap-2">
              <Wheat className="w-5 h-5 text-[#FFC107]" />
              <h2 className="text-lg font-bold text-white">
                {lang === 'en'
                  ? 'Rice & Noodle Portioning & Costing'
                  : 'การจัดการต้นทุน ข้าวและเส้น (Rice & Noodle Portioning)'}
              </h2>
            </div>
          </div>

          {/* Standard Portion Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {standardPortions.map((portion) => (
              <div
                key={portion.id}
                className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-5 hover:border-white/20 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFC107]/20 text-[#FFC107]">
                      {lang === 'en' ? portion.typeEn : portion.type}
                    </span>
                    <span className="text-[10px] text-white/40 font-mono">
                      {lang === 'en' ? 'Serving:' : 'ขนาดเสิร์ฟ:'} {portion.portionGram}g
                    </span>
                  </div>

                  <h3 className="font-bold text-white text-base">
                    {lang === 'en' ? portion.nameEn : portion.name}
                  </h3>

                  {/* Details table */}
                  <div className="mt-3 p-3 rounded-2xl bg-black/30 border border-white/5 space-y-1.5 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="font-sans text-white/50">
                        {lang === 'en' ? 'Base Ingredient:' : 'วัตถุดิบหลัก:'}
                      </span>
                      <span className="text-white">
                        {lang === 'en' ? portion.rawIngredientNameEn : portion.rawIngredientName}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans text-white/50">
                        {lang === 'en' ? 'Market Price:' : 'ราคาตลาด:'}
                      </span>
                      <span className="text-white">
                        {lang === 'en' ? portion.rawPurchaseCostEn : portion.rawPurchaseCost}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans text-white/50">
                        {lang === 'en' ? 'Cooking Yield:' : 'Yield การหุง/ลวก:'}
                      </span>
                      <span className="text-emerald-400 font-bold">
                        {lang === 'en' ? portion.cookingYieldEn : portion.cookingYield}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-white/10 font-bold text-sm">
                      <span className="font-sans text-white">
                        {lang === 'en' ? 'Cost per Dish:' : 'ต้นทุนต่อจาน:'}
                      </span>
                      <span className="text-[#FFC107]">฿{portion.costPerPortion.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

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
    </div>
  );
};
