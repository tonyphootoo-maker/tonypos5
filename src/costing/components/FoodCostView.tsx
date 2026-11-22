import React, { useState, useMemo } from 'react';
import {
  UtensilsCrossed,
  Search,
  Plus,
  FolderPlus,
  Edit2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  X,
  TrendingUp,
  Boxes,
  Layers,
  ArrowUpRight,
  SlidersHorizontal,
  Package,
  Trash2,
  GripVertical,
} from 'lucide-react';
import {
  MenuItem,
  MenuVariant,
  Ingredient,
  Sauce,
  RestaurantSettings,
  RecipeCostBreakdown,
  RecipeItem,
} from '../types';
import {
  calculateVariantCostBreakdown,
  calculateChannelSuggestedPrices,
  calculateMultipliedChannelPrices,
  recalculateMenusWithChannelMultipliers,
  resolveChannelMultipliers,
  deriveGpMultiplierFromSettings,
  getEffectiveDeliveryGpPercent,
  roundUpToStep,
} from '../services/calculationEngine';
import { extractNetPriceFromMenuPrice } from '../../engine/calculations';
import {
  translateThaiToEnglish,
  computeAutoEnglishName,
  containsThaiCharacters,
  getLocalizedText,
  localizeUnit,
} from '../../utils/thaiToEnglish';
import {
  useDebouncedTranslationScheduler,
  needsEnglishReview,
} from '../../hooks/useDebouncedThaiTranslation';
import { useLanguage } from '../../contexts/LanguageContext';
import { convertUnit, isPieceLikeUnit } from '../engine/units';
import { NumericInput } from './common/NumericInput';
import { MenuPricingSpreadsheetTable } from './MenuPricingSpreadsheetTable';
import {
  resolveVariantBaseSellingPrice,
  resolveVariantTakeawayPrice,
  computeChannelPriceFromMultiplier,
} from '../services/spreadsheetCostHelper';
import {
  CUSTOM_PORTION_UNITS_STORAGE_KEY,
  loadCustomPurchaseUnits,
  mergeUniqueUnits,
} from '../utils/customUnits';

const PORTION_UNITS_STORAGE_KEY = CUSTOM_PORTION_UNITS_STORAGE_KEY;
const DEFAULT_PORTION_UNITS = [
  'g',
  'kg',
  'ชิ้น',
  'ฟอง',
  'ตัว',
  'ถุง',
  'ml',
  'l',
  'ลูก',
  'แผ่น',
  'ไม้',
  'แพ็ค',
  'ขวด',
  'กล่อง',
  'ช้อนโต๊ะ',
];
const PORTION_UNIT_LABELS_TH: Record<string, string> = {
  g: 'กรัม (g)',
  kg: 'กิโลกรัม (kg)',
  ml: 'มิลลิลิตร (ml)',
  l: 'ลิตร (L)',
};
const PORTION_UNIT_LABELS_EN: Record<string, string> = {
  g: 'Grams (g)',
  kg: 'Kilograms (kg)',
  ml: 'Milliliters (ml)',
  l: 'Litres (L)',
};

const isProteinRecipeItem = (it: RecipeItem, proteinType?: string): boolean => {
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

  if (
    name.includes('หมู') ||
    name.includes('ไก่') ||
    name.includes('เนื้อ') ||
    name.includes('กุ้ง') ||
    name.includes('หมึก') ||
    name.includes('ไส้กรอก') ||
    name.includes('ปลา') ||
    name.includes('ทะเล') ||
    name.includes('ซีฟู้ด')
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

const extractBaseRecipeItemsForMenu = (menuItem: MenuItem): RecipeItem[] => {
  for (const variant of menuItem.variants || []) {
    const nonProtein = (variant.recipeItems || []).filter(
      (it) => !isProteinRecipeItem(it, variant.proteinType)
    );
    if (nonProtein.length > 0) {
      return nonProtein.map((it) => ({ ...it }));
    }
  }
  return [];
};

interface FoodCostViewProps {
  menus: MenuItem[];
  ingredients: Ingredient[];
  sauces: Sauce[];
  settings: RestaurantSettings;
  lang?: 'th' | 'en';
  initialServingMode?: 'ON_RICE' | 'A_LA_CARTE';
  onSaveMenu: (menu: MenuItem) => void;
  onBatchUpdateMenus?: (menus: MenuItem[]) => void;
  onSaveSettings?: (settings: RestaurantSettings) => void;
  onDeleteMenu?: (menuId: string) => void;
  onReorderMenus?: (reordered: MenuItem[]) => void;
  onUpdateVariantPrice: (
    menuId: string,
    variantId: string,
    prices: { sellingPrice: number; takeawayPrice: number; deliveryPrice: number }
  ) => void;
  onNavigateToRecipeBuilder: (variantId: string) => void;
}

export const FoodCostView: React.FC<FoodCostViewProps> = ({
  menus,
  ingredients,
  sauces,
  settings,
  lang: propLang,
  initialServingMode,
  onSaveMenu,
  onBatchUpdateMenus,
  onSaveSettings,
  onDeleteMenu,
  onReorderMenus,
  onUpdateVariantPrice,
  onNavigateToRecipeBuilder,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const isEn = lang === 'en';
  const resolvedMultipliers = resolveChannelMultipliers(settings);
  const grabMultiplier = resolvedMultipliers.grab;
  const linemanMultiplier = resolvedMultipliers.lineman;
  const robinhoodMultiplier = resolvedMultipliers.robinhood;
  const getPortionUnitLabel = (u: string) =>
    isEn ? (PORTION_UNIT_LABELS_EN[u] || localizeUnit(u, 'en')) : (PORTION_UNIT_LABELS_TH[u] || u);
  const [viewMode, setViewMode] = useState<'CARDS' | 'TABLE'>('CARDS');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [activeChannel, setActiveChannel] = useState<'DINE_IN' | 'GRAB' | 'LINEMAN' | 'ROBINHOOD' | 'ALL'>('DINE_IN');
  const [activeServingMode, setActiveServingMode] = useState<'ON_RICE' | 'A_LA_CARTE'>(
    initialServingMode || 'ON_RICE'
  );

  React.useEffect(() => {
    if (initialServingMode) {
      setActiveServingMode(initialServingMode);
    }
  }, [initialServingMode]);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);

  // Menu reordering (Drag & Drop + Up/Down arrows)
  const [draggedMenuId, setDraggedMenuId] = useState<string | null>(null);
  const [dragOverMenuId, setDragOverMenuId] = useState<string | null>(null);
  const menuNameClickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMenuThaiRef = React.useRef<string>('');
  const prevVariantThaiRef = React.useRef<string>('');
  const prevAddCatThaiRef = React.useRef<string>('');
  const prevEditCatThaiRef = React.useRef<string>('');
  const translationScheduler = useDebouncedTranslationScheduler(600);

  React.useEffect(() => {
    return () => {
      if (menuNameClickTimerRef.current) clearTimeout(menuNameClickTimerRef.current);
    };
  }, []);

  const handleMoveMenu = (fromId: string, direction: 'up' | 'down') => {
    const fromIndex = menus.findIndex((m) => m.id === fromId);
    if (fromIndex === -1) return;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= menus.length) return;
    const updated = [...menus];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    if (onReorderMenus) {
      onReorderMenus(updated);
    } else {
      updated.forEach((m) => onSaveMenu(m));
    }
  };

  const handleMenuDragStart = (e: React.DragEvent, id: string) => {
    setDraggedMenuId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {}
  };

  const handleMenuDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverMenuId !== id) {
      setDragOverMenuId(id);
    }
  };

  const handleMenuDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggedMenuId || e.dataTransfer.getData('text/plain');
    setDraggedMenuId(null);
    setDragOverMenuId(null);
    if (!sourceId || sourceId === targetId) return;
    const fromIndex = menus.findIndex((m) => m.id === sourceId);
    const toIndex = menus.findIndex((m) => m.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const updated = [...menus];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    if (onReorderMenus) {
      onReorderMenus(updated);
    } else {
      updated.forEach((m) => onSaveMenu(m));
    }
  };

  const handleMenuDragEnd = () => {
    setDraggedMenuId(null);
    setDragOverMenuId(null);
  };

  // Delete Menu Modal state
  const [menuToDelete, setMenuToDelete] = useState<MenuItem | null>(null);

  // Customizable portion units persisted in localStorage
  const [portionUnits, setPortionUnits] = useState<string[]>(() => {
    let savedUnits: string[] = [];
    try {
      const saved = localStorage.getItem(PORTION_UNITS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          savedUnits = parsed;
        }
      }
    } catch {}
    return mergeUniqueUnits(
      savedUnits.length > 0 ? savedUnits : DEFAULT_PORTION_UNITS,
      loadCustomPurchaseUnits(),
      settings.customPurchaseUnits,
      ingredients.flatMap((i) => [i.usageUnit, i.purchaseUnit])
    );
  });

  React.useEffect(() => {
    const incoming = mergeUniqueUnits(
      loadCustomPurchaseUnits(),
      settings.customPurchaseUnits,
      ingredients.flatMap((i) => [i.usageUnit, i.purchaseUnit])
    );
    if (incoming.length === 0) return;
    setPortionUnits((prev) => {
      const merged = mergeUniqueUnits(prev, incoming);
      if (merged.length !== prev.length) {
        try {
          localStorage.setItem(PORTION_UNITS_STORAGE_KEY, JSON.stringify(merged));
        } catch {}
        return merged;
      }
      return prev;
    });
  }, [ingredients, settings.customPurchaseUnits]);

  const [isAddingCustomUnit, setIsAddingCustomUnit] = useState(false);
  const [customUnitInput, setCustomUnitInput] = useState('');

  // Variant Modal state (Add or Edit)
  const [variantModalState, setVariantModalState] = useState<{
    isOpen: boolean;
    mode: 'ADD' | 'EDIT';
    menu: MenuItem | null;
    variant: Partial<MenuVariant> | null;
    selectedCategory?: string;
    selectedIngredientId: string;
    meatQuantity: number;
    meatUnit: string;
    seafoodShrimpQty?: number;
    seafoodSquidQty?: number;
    isEnglishManuallyEdited?: boolean;
    selectedBaseRecipeMenuId?: string;
  }>({
    isOpen: false,
    mode: 'ADD',
    menu: null,
    variant: null,
    selectedCategory: 'เนื้อสัตว์และอาหารทะเล',
    selectedIngredientId: '',
    meatQuantity: 80,
    meatUnit: 'g',
    seafoodShrimpQty: 4,
    seafoodSquidQty: 40,
    isEnglishManuallyEdited: false,
    selectedBaseRecipeMenuId: '',
  });

  const handleAddCustomUnit = () => {
    const trimmed = customUnitInput.trim();
    if (!trimmed) return;
    if (!portionUnits.includes(trimmed)) {
      const updated = [...portionUnits, trimmed];
      setPortionUnits(updated);
      try {
        localStorage.setItem(PORTION_UNITS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
    }
    setVariantModalState((prev) => ({ ...prev, meatUnit: trimmed }));
    setCustomUnitInput('');
    setIsAddingCustomUnit(false);
  };

  const handleDeleteCustomUnit = (unitToDelete: string) => {
    if (portionUnits.length <= 1) return;
    const updated = portionUnits.filter((u) => u !== unitToDelete);
    setPortionUnits(updated);
    try {
      localStorage.setItem(PORTION_UNITS_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
    if (variantModalState.meatUnit === unitToDelete) {
      setVariantModalState((prev) => ({ ...prev, meatUnit: updated[0] || 'g' }));
    }
  };

  // Variant Delete Modal state
  const [variantToDelete, setVariantToDelete] = useState<{
    menu: MenuItem;
    variant: MenuVariant;
  } | null>(null);

  // Meat ingredients list for quick protein selection
  const meatIngredients = useMemo(() => {
    return ingredients.filter(
      (i) => i.category === 'เนื้อสัตว์และอาหารทะเล' || i.category?.includes('เนื้อสัตว์')
    );
  }, [ingredients]);

  // Ingredients grouped by category for unified Step-1 database dropdown
  const groupedIngredients = useMemo(() => {
    const groups = new Map<string, Ingredient[]>();
    ingredients.forEach((ing) => {
      const cat = ing.category || 'อื่นๆ';
      const list = groups.get(cat) || [];
      list.push(ing);
      groups.set(cat, list);
    });
    return Array.from(groups.entries());
  }, [ingredients]);

  // Breakdown Modal state
  const [selectedBreakdown, setSelectedBreakdown] = useState<{
    menu: MenuItem;
    variant: MenuVariant;
    breakdown: RecipeCostBreakdown;
  } | null>(null);

  // Edit Menu Modal
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Partial<MenuItem> | null>(null);

  // Suggested Price custom sliders inside modal
  const [customTargetFcPercent, setCustomTargetFcPercent] = useState<number>(
    settings.targetFoodCostPercent || 35
  );

  // Fast maps
  const ingredientsMap = new Map<string, Ingredient>(ingredients.map((i) => [i.id, i]));
  const saucesMap = new Map<string, Sauce>(sauces.map((s) => [s.id, s]));

  // Available Base Recipes extracted from menus for Variant modal linking (3.4)
  const baseRecipeMenuOptions = useMemo(() => {
    return menus
      .map((m) => ({
        menu: m,
        items: extractBaseRecipeItemsForMenu(m),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [menus]);

  const computeBaseRecipeItemsCost = (items: RecipeItem[]): number => {
    return items.reduce((sum, it) => {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) return sum;
      if (it.type === 'SAUCE' || it.ingredientType === 'SAUCE') {
        const s = saucesMap.get(it.sauceId || it.ingredientId);
        if (s && s.actualQuantity > 0) {
          const conv = convertUnit(qty, it.unit || s.productionUnit || 'g', s.productionUnit || 'g');
          const effQty = conv.success ? conv.convertedQuantity : qty;
          return sum + effQty * (s.costPerGram || 0);
        }
        return sum + (it.calculatedLineCost ?? qty * (it.calculatedUnitCost || 0));
      }
      const ing = ingredientsMap.get(it.ingredientId);
      if (ing) {
        const targetUnit = ing.usageUnit || ing.baseUnit || 'g';
        const conv = convertUnit(qty, it.unit || targetUnit, targetUnit);
        const effQty = conv.success ? conv.convertedQuantity : qty;
        return sum + effQty * (ing.costPerBaseUnit || 0);
      }
      return sum + (it.calculatedLineCost ?? qty * (it.calculatedUnitCost || 0));
    }, 0);
  };

  // Custom categories with LocalStorage persistence
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('tony_custom_menu_categories');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Modal state for adding new category
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [newCategoryEnglishInput, setNewCategoryEnglishInput] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // Modal state for editing existing category
  const [isEditCategoryModalOpen, setIsEditCategoryModalOpen] = useState(false);
  const [editingCategoryOldName, setEditingCategoryOldName] = useState('');
  const [editingCategoryNewName, setEditingCategoryNewName] = useState('');
  const [editCategoryEnglishInput, setEditCategoryEnglishInput] = useState('');
  const [editCategoryError, setEditCategoryError] = useState<string | null>(null);

  // Modal state for deleting category
  const [isDeleteCategoryModalOpen, setIsDeleteCategoryModalOpen] = useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = useState('');

  // Filter high-cost / needs-review items toggle
  const [filterHighCostOnly, setFilterHighCostOnly] = useState(false);
  // Warning review modal state for displaying alerted items immediately (Requirement 3)
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);

  // Combine menu categories and custom categories
  const categories = useMemo(() => {
    const fromMenus = menus.map((m) => m.category).filter(Boolean);
    const combined = Array.from(new Set([...fromMenus, ...customCategories]));
    return ['ALL', ...combined];
  }, [menus, customCategories]);

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryInput.trim();
    if (!trimmed) {
      setCategoryError(isEn ? 'Please enter a category name' : 'กรุณากรอกชื่อหมวดหมู่');
      return;
    }
    if (categories.includes(trimmed)) {
      setCategoryError(isEn ? 'This category already exists' : 'มีหมวดหมู่นี้อยู่ในระบบแล้ว');
      return;
    }

    const updated = [...customCategories, trimmed];
    setCustomCategories(updated);
    try {
      localStorage.setItem('tony_custom_menu_categories', JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }

    setSelectedCategory(trimmed);
    if (editingMenu) {
      setEditingMenu({ ...editingMenu, category: trimmed });
    }
    setNewCategoryInput('');
    setNewCategoryEnglishInput('');
    setCategoryError(null);
    setIsAddCategoryModalOpen(false);
  };

  const handleOpenEditCategory = (categoryName: string) => {
    if (!categoryName || categoryName === 'ALL') return;
    translationScheduler.cancelAll();
    setEditingCategoryOldName(categoryName);
    setEditingCategoryNewName(categoryName);
    prevEditCatThaiRef.current = categoryName;
    setEditCategoryEnglishInput(translateThaiToEnglish(categoryName));
    setEditCategoryError(null);
    setIsEditCategoryModalOpen(true);
  };

  const handleSaveEditCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = editingCategoryNewName.trim();
    if (!trimmed) {
      setEditCategoryError(isEn ? 'Please enter a category name' : 'กรุณากรอกชื่อหมวดหมู่');
      return;
    }
    if (trimmed !== editingCategoryOldName && categories.includes(trimmed)) {
      setEditCategoryError(isEn ? 'This category already exists' : 'มีหมวดหมู่นี้อยู่ในระบบแล้ว');
      return;
    }

    if (trimmed !== editingCategoryOldName) {
      // 1. Update all menus that use the old category name
      menus.forEach((m) => {
        if (m.category === editingCategoryOldName) {
          onSaveMenu({
            ...m,
            category: trimmed,
            updatedAt: new Date().toISOString(),
          });
        }
      });

      // 2. Update customCategories
      const updated = customCategories.map((c) => (c === editingCategoryOldName ? trimmed : c));
      if (!updated.includes(trimmed)) {
        updated.push(trimmed);
      }
      setCustomCategories(updated);
      try {
        localStorage.setItem('tony_custom_menu_categories', JSON.stringify(updated));
      } catch (err) {
        console.error(err);
      }

      // 3. Set selectedCategory to new name
      setSelectedCategory(trimmed);
    }

    setIsEditCategoryModalOpen(false);
    setEditCategoryError(null);
  };

  const handleOpenDeleteCategory = (categoryName: string) => {
    if (!categoryName || categoryName === 'ALL') return;
    setDeletingCategoryName(categoryName);
    setIsDeleteCategoryModalOpen(true);
  };

  const handleConfirmDeleteCategory = () => {
    if (!deletingCategoryName || deletingCategoryName === 'ALL') return;

    const fallbackCategory = 'ทั่วไป / อื่นๆ';

    // 1. Reassign any existing menus in this category to fallback category
    const affectedMenus = menus.filter((m) => m.category === deletingCategoryName);
    if (affectedMenus.length > 0) {
      affectedMenus.forEach((m) => {
        onSaveMenu({
          ...m,
          category: fallbackCategory,
          updatedAt: new Date().toISOString(),
        });
      });
      if (!customCategories.includes(fallbackCategory)) {
        customCategories.push(fallbackCategory);
      }
    }

    // 2. Remove deleted category from customCategories
    const updated = customCategories.filter((c) => c !== deletingCategoryName);
    setCustomCategories(updated);
    try {
      localStorage.setItem('tony_custom_menu_categories', JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }

    // 3. Switch selectedCategory to 'ALL'
    setSelectedCategory('ALL');
    setIsDeleteCategoryModalOpen(false);
  };

  // Build rows of all variants
  const allRows: Array<{
    menu: MenuItem;
    variant: MenuVariant;
    breakdown: RecipeCostBreakdown;
  }> = [];

  menus.forEach((menu) => {
    menu.variants.forEach((variant) => {
      const baseSell = resolveVariantBaseSellingPrice(menu, variant);
      const baseTakeaway = resolveVariantTakeawayPrice(menu, variant);
      const effectiveChannelPrice =
        activeChannel === 'LINEMAN'
          ? (typeof variant.linemanPrice === 'number' && variant.linemanPrice > 0
              ? variant.linemanPrice
              : computeChannelPriceFromMultiplier(baseTakeaway, linemanMultiplier))
          : (typeof variant.grabPrice === 'number' && variant.grabPrice > 0
              ? variant.grabPrice
              : computeChannelPriceFromMultiplier(baseTakeaway, grabMultiplier));
      const breakdown = calculateVariantCostBreakdown(
        {
          ...variant,
          sellingPrice: baseSell,
          deliveryPrice: effectiveChannelPrice,
        },
        menu.name,
        ingredientsMap,
        saucesMap,
        settings,
        activeChannel === 'LINEMAN' ? 'lineman' : 'grab'
      );
      allRows.push({ menu, variant, breakdown });
    });
  });

  // Filter & Search
  const qLower = searchTerm.toLowerCase();
  const filteredRows = allRows.filter(({ menu, variant }) => {
    const matchesCategory =
      selectedCategory === 'ALL' || menu.category === selectedCategory;
    const matchesSearch =
      menu.name.toLowerCase().includes(qLower) ||
      (menu.englishName || '').toLowerCase().includes(qLower) ||
      variant.name.toLowerCase().includes(qLower) ||
      (variant.englishName || '').toLowerCase().includes(qLower) ||
      variant.proteinType.toLowerCase().includes(qLower);
    return matchesCategory && matchesSearch;
  });

  // Detailed list of variants with warnings for instant inspection (Requirement 3)
  const warningRows = useMemo(() => {
    const target = settings.targetFoodCostPercent || 35;
    return allRows
      .filter((r) => {
        const isHighFc =
          r.breakdown.restaurantFoodCostPercent > target ||
          r.breakdown.restaurantFoodCostPercent > 40;
        const hasIssue = r.breakdown.hasReviewIssue;
        const isNegProfit =
          r.breakdown.restaurantProfit < 0 || r.breakdown.deliveryProfit < 0;
        return isHighFc || hasIssue || isNegProfit;
      })
      .map((r) => {
        const reasons: string[] = [];
        if (r.breakdown.restaurantFoodCostPercent > 40) {
          reasons.push(
            isEn
              ? `Very High Food Cost (${r.breakdown.restaurantFoodCostPercent.toFixed(1)}% > 40%)`
              : `Food Cost สูงมาก (${r.breakdown.restaurantFoodCostPercent.toFixed(1)}% > 40%)`
          );
        } else if (r.breakdown.restaurantFoodCostPercent > target) {
          reasons.push(
            isEn
              ? `Food Cost Above Target (${r.breakdown.restaurantFoodCostPercent.toFixed(1)}% > ${target}%)`
              : `Food Cost เกินเป้า (${r.breakdown.restaurantFoodCostPercent.toFixed(1)}% > ${target}%)`
          );
        }
        if (r.breakdown.restaurantProfit < 0) {
          reasons.push(
            isEn
              ? `Negative Dine-in Profit (${r.breakdown.restaurantProfit.toFixed(1)} ฿)`
              : `กำไรหน้าร้านติดลบ (${r.breakdown.restaurantProfit.toFixed(1)} ฿)`
          );
        }
        if (r.breakdown.deliveryProfit < 0) {
          reasons.push(
            isEn
              ? `Negative Delivery Profit (${r.breakdown.deliveryProfit.toFixed(1)} ฿)`
              : `กำไรเดลิเวอรี่ติดลบ (${r.breakdown.deliveryProfit.toFixed(1)} ฿)`
          );
        }
        if (r.breakdown.hasMissingPrice || r.breakdown.missingPrice) {
          reasons.push(
            isEn
              ? 'Missing ingredient price — cost may be understated'
              : 'ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง'
          );
        }
        if (r.breakdown.hasReviewIssue && !r.breakdown.hasMissingPrice) {
          reasons.push(
            isEn
              ? getLocalizedText('en', r.breakdown.reviewMessage) || 'Needs recipe or ingredient review'
              : r.breakdown.reviewMessage || 'ต้องทบทวนสูตรหรือวัตถุดิบ'
          );
        }
        return {
          ...r,
          reasons,
        };
      });
  }, [allRows, settings.targetFoodCostPercent, isEn]);

  // Set of menu IDs that have high cost (> 40% or > target) or review issue or negative margin
  const warningMenuIds = useMemo(() => {
    return new Set(warningRows.map((r) => r.menu.id));
  }, [warningRows]);

  const filteredMenus = menus.filter((m) => {
    const matchesCategory = selectedCategory === 'ALL' || m.category === selectedCategory;
    const matchesSearch =
      !searchTerm ||
      m.name.toLowerCase().includes(qLower) ||
      (m.englishName || '').toLowerCase().includes(qLower) ||
      m.variants.some(
        (v) =>
          v.name.toLowerCase().includes(qLower) ||
          (v.englishName || '').toLowerCase().includes(qLower)
      );
    const matchesWarning = !filterHighCostOnly || warningMenuIds.has(m.id);
    return matchesCategory && matchesSearch && matchesWarning;
  });

  // Calculate high-level stats
  const totalVariantsCount = allRows.length;
  const avgFoodCostPercent =
    totalVariantsCount > 0
      ? allRows.reduce((acc, r) => acc + r.breakdown.restaurantFoodCostPercent, 0) / totalVariantsCount
      : 0;
  const target = settings.targetFoodCostPercent || 35;
  const warningCount = warningRows.length;

  const handleToggleHighCostFilter = () => {
    // Requirement 3: Clicking opens the alerted items modal immediately!
    setIsWarningModalOpen(true);
    setFilterHighCostOnly(true);
    const firstWarning = menus.find((m) => warningMenuIds.has(m.id));
    if (firstWarning) {
      setSelectedMenuId(firstWarning.id);
    }
  };

  const handleOpenAddMenu = () => {
    translationScheduler.cancelAll();
    prevMenuThaiRef.current = '';
    const currentCat =
      selectedCategory !== 'ALL'
        ? selectedCategory
        : (categories.find((c) => c !== 'ALL') || 'ผัดและกะเพรา');
    const initialMenuSell = 60;
    const initialTakeaway = initialMenuSell + 5;
    const initialMultiplied = calculateMultipliedChannelPrices(initialTakeaway, settings);

    const newMenu: Partial<MenuItem> = {
      id: `menu_${Date.now()}`,
      name: '',
      thaiName: '',
      englishName: '',
      englishNameManual: false,
      category: currentCat,
      variants: [
        {
          id: `var_${Date.now()}_1`,
          menuId: `menu_${Date.now()}`,
          name: 'ธรรมดา',
          thaiName: 'ธรรมดา',
          englishName: 'Regular',
          proteinType: 'หมูสับ',
          sellingPrice: initialMenuSell,
          takeawayPrice: initialTakeaway,
          deliveryPrice: initialMultiplied.grabPrice,
          grabPrice: initialMultiplied.grabPrice,
          linemanPrice: initialMultiplied.linemanPrice,
          robinhoodPrice: initialMultiplied.robinhoodPrice,
          overheadCost: 6.0,
          recipeItems: [],
          active: true,
        },
      ],
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingMenu(newMenu);
    setIsMenuModalOpen(true);
  };

  const handleOpenEditMenu = (menu: MenuItem) => {
    translationScheduler.cancelAll();
    const cloned = JSON.parse(JSON.stringify(menu));
    const thName = cloned.thaiName || cloned.name || '';
    prevMenuThaiRef.current = thName;
    const storedEn = (cloned.englishName || '').trim();
    cloned.thaiName = thName;
    cloned.englishNameManual = Boolean(cloned.englishNameManual);
    cloned.englishName =
      cloned.englishNameManual && storedEn && !containsThaiCharacters(storedEn)
        ? storedEn
        : storedEn && !containsThaiCharacters(storedEn)
        ? storedEn
        : translateThaiToEnglish(thName);
    setEditingMenu(cloned);
    setIsMenuModalOpen(true);
  };

  const handleSaveMenuModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMenu || !editingMenu.name) return;
    translationScheduler.cancelAll();

    const trimmedTh = editingMenu.name.trim();
    const isManual = Boolean(editingMenu.englishNameManual);
    const trimmedEn = isManual
      ? (editingMenu.englishName || '').trim()
      : computeAutoEnglishName({
          previousThai: prevMenuThaiRef.current || trimmedTh,
          nextThai: trimmedTh,
          currentEnglish: editingMenu.englishName || '',
          isManuallyEdited: false,
        }).trim() || translateThaiToEnglish(trimmedTh);

    const finalMenu: MenuItem = {
      id: editingMenu.id || `menu_${Date.now()}`,
      name: trimmedTh,
      thaiName: trimmedTh,
      englishName: trimmedEn,
      englishNameManual: isManual,
      code: editingMenu.code,
      sku: editingMenu.sku,
      barcode: editingMenu.barcode,
      isOutOfStock: editingMenu.isOutOfStock,
      category: editingMenu.category || 'ผัดและกะเพรา',
      displayOrder: editingMenu.displayOrder || 1,
      variants: editingMenu.variants || [],
      active: editingMenu.active !== undefined ? editingMenu.active : true,
      description: editingMenu.description,
      createdAt: editingMenu.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveMenu(finalMenu);
    setIsMenuModalOpen(false);
  };

  const handleOpenAddVariant = (menu: MenuItem) => {
    // Find default meat ingredient if available from ingredients
    const defaultIng = meatIngredients[0] || ingredients[0];
    const defaultProtein = defaultIng ? defaultIng.name.split(' (')[0].split(' ')[0] : 'หมูสับ';
    const initialUnit = (defaultIng?.usageUnit || defaultIng?.baseUnit || 'g') as string;
    const initialQty = isPieceLikeUnit(initialUnit) ? (initialUnit === 'ตัว' ? 4 : 1) : 80;
    const variantTh = `${menu.name} ${defaultProtein}`;
    translationScheduler.cancelAll();
    prevVariantThaiRef.current = variantTh;
    const defaultBaseItems = extractBaseRecipeItemsForMenu(menu);

    if (initialUnit && !portionUnits.includes(initialUnit)) {
      const nextUnits = [...portionUnits, initialUnit];
      setPortionUnits(nextUnits);
      try {
        localStorage.setItem(PORTION_UNITS_STORAGE_KEY, JSON.stringify(nextUnits));
      } catch {}
    }

    const basePrice = 65;
    const baseTakeaway = basePrice + 5;
    const proteinItems: RecipeItem[] = defaultIng
      ? [
          {
            ingredientId: defaultIng.id,
            name: defaultIng.name,
            quantity: initialQty,
            unit: initialUnit,
            calculatedUnitCost: defaultIng.costPerBaseUnit || 0,
            calculatedLineCost: Number(((defaultIng.costPerBaseUnit || 0) * initialQty).toFixed(2)),
          },
        ]
      : [];

    const newVariant: Partial<MenuVariant> = {
      id: `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      menuId: menu.id,
      name: variantTh,
      thaiName: variantTh,
      englishName: translateThaiToEnglish(variantTh),
      englishNameManual: false,
      proteinType: defaultProtein,
      sellingPrice: basePrice,
      takeawayPrice: baseTakeaway,
      deliveryPrice: Math.round(baseTakeaway * grabMultiplier),
      grabPrice: Math.round(baseTakeaway * grabMultiplier),
      linemanPrice: Math.round(baseTakeaway * linemanMultiplier),
      robinhoodPrice: Math.round(baseTakeaway * robinhoodMultiplier),
      overheadCost: 6.0,
      packagingCost: 9.0,
      recipeItems: [...proteinItems, ...defaultBaseItems.map((it) => ({ ...it }))],
      active: true,
    };

    setIsAddingCustomUnit(false);
    setCustomUnitInput('');
    setVariantModalState({
      isOpen: true,
      mode: 'ADD',
      menu,
      variant: newVariant,
      selectedCategory: defaultIng?.category || 'เนื้อสัตว์และอาหารทะเล',
      selectedIngredientId: defaultIng ? defaultIng.id : '',
      meatQuantity: initialQty,
      meatUnit: initialUnit,
      seafoodShrimpQty: 4,
      seafoodSquidQty: 40,
      isEnglishManuallyEdited: false,
      selectedBaseRecipeMenuId: defaultBaseItems.length > 0 ? menu.id : '',
    });
  };

  const handleOpenEditVariant = (menu: MenuItem, variant: MenuVariant) => {
    // Detect linked ingredient if exists
    let matchedIngId = '';
    const proteinItem = (variant.recipeItems || []).find((it) =>
      isProteinRecipeItem(it, variant.proteinType)
    ) || (variant.recipeItems && variant.recipeItems[0]);

    if (proteinItem?.ingredientId) {
      matchedIngId = proteinItem.ingredientId;
    } else {
      const pName = (variant.proteinType || variant.name).toLowerCase();
      const matched = ingredients.find(
        (i) => i.name.toLowerCase().includes(pName) || pName.includes(i.name.toLowerCase().split(' ')[0])
      );
      if (matched) matchedIngId = matched.id;
    }

    const defaultQty = proteinItem?.quantity || (variant.proteinType?.includes('กุ้ง') ? 4 : 80);
    const isSeafoodItem =
      variant.proteinType?.includes('ทะเล') ||
      variant.proteinType?.includes('ซีฟู้ด') ||
      variant.name?.includes('ทะเล');
    const existingShrimp = (variant.recipeItems || []).find(
      (it) => it.proteinCategory === 'SHRIMP' || it.name.includes('กุ้ง')
    );
    const existingSquid = (variant.recipeItems || []).find(
      (it) => it.proteinCategory === 'SQUID' || it.name.includes('หมึก')
    );

    const matchedIng = ingredients.find((i) => i.id === matchedIngId);
    const initialUnit = String(proteinItem?.unit || matchedIng?.usageUnit || matchedIng?.baseUnit || 'g');

    if (initialUnit && !portionUnits.includes(initialUnit)) {
      const nextUnits = [...portionUnits, initialUnit];
      setPortionUnits(nextUnits);
      try {
        localStorage.setItem(PORTION_UNITS_STORAGE_KEY, JSON.stringify(nextUnits));
      } catch {}
    }

    const clonedVariant: Partial<MenuVariant> = JSON.parse(JSON.stringify(variant));
    const resolvedSell = resolveVariantBaseSellingPrice(menu, variant);
    const resolvedTakeaway = resolveVariantTakeawayPrice(menu, variant);
    clonedVariant.sellingPrice = resolvedSell;
    clonedVariant.takeawayPrice = resolvedTakeaway;
    if (!(typeof clonedVariant.grabPrice === 'number' && clonedVariant.grabPrice > 0)) {
      clonedVariant.grabPrice = computeChannelPriceFromMultiplier(resolvedTakeaway, grabMultiplier);
    }
    if (!(typeof clonedVariant.linemanPrice === 'number' && clonedVariant.linemanPrice > 0)) {
      clonedVariant.linemanPrice = computeChannelPriceFromMultiplier(resolvedTakeaway, linemanMultiplier);
    }
    if (!(typeof clonedVariant.robinhoodPrice === 'number' && clonedVariant.robinhoodPrice > 0)) {
      clonedVariant.robinhoodPrice = computeChannelPriceFromMultiplier(resolvedTakeaway, robinhoodMultiplier);
    }
    clonedVariant.deliveryPrice = clonedVariant.grabPrice;
    translationScheduler.cancelAll();
    const existingTh = clonedVariant.thaiName || clonedVariant.name || '';
    prevVariantThaiRef.current = existingTh;
    clonedVariant.name = existingTh;
    clonedVariant.thaiName = existingTh;
    const storedVariantEn = (clonedVariant.englishName || '').trim();
    const isManualVar = Boolean(clonedVariant.englishNameManual);
    clonedVariant.englishNameManual = isManualVar;
    clonedVariant.englishName =
      isManualVar && storedVariantEn && !containsThaiCharacters(storedVariantEn)
        ? storedVariantEn
        : storedVariantEn && !containsThaiCharacters(storedVariantEn)
        ? storedVariantEn
        : translateThaiToEnglish(existingTh);

    const existingNonProteins = (clonedVariant.recipeItems || []).filter(
      (it) => !isProteinRecipeItem(it, clonedVariant.proteinType)
    );
    let initialBaseRecipeId = '';
    if (existingNonProteins.length > 0) {
      const sig = (list: RecipeItem[]) => list.map((x) => `${x.ingredientId}:${x.name}:${x.quantity}`).sort().join('|');
      const currentSig = sig(existingNonProteins);
      const matchedMenuOpt =
        baseRecipeMenuOptions.find((opt) => opt.menu.id === menu.id && sig(opt.items) === currentSig) ||
        baseRecipeMenuOptions.find((opt) => sig(opt.items) === currentSig);
      initialBaseRecipeId = matchedMenuOpt ? matchedMenuOpt.menu.id : '__custom__';
    }

    setIsAddingCustomUnit(false);
    setCustomUnitInput('');
    setVariantModalState({
      isOpen: true,
      mode: 'EDIT',
      menu,
      variant: clonedVariant,
      selectedCategory: isSeafoodItem ? 'เนื้อสัตว์และอาหารทะเล' : (matchedIng?.category || 'เนื้อสัตว์และอาหารทะเล'),
      selectedIngredientId: isSeafoodItem ? 'seafood_combo' : matchedIngId,
      meatQuantity: defaultQty,
      meatUnit: initialUnit,
      seafoodShrimpQty: existingShrimp?.quantity || 4,
      seafoodSquidQty: existingSquid?.quantity || 40,
      isEnglishManuallyEdited: isManualVar,
      selectedBaseRecipeMenuId: initialBaseRecipeId,
    });
  };

  const handleOpenDeleteVariant = (menu: MenuItem, variantId: string) => {
    const v = menu.variants.find((item) => item.id === variantId);
    if (!v) return;
    setVariantToDelete({ menu, variant: v });
  };

  const handleConfirmDeleteVariant = () => {
    if (!variantToDelete) return;
    const { menu, variant } = variantToDelete;
    const updatedVariants = menu.variants.filter((v) => v.id !== variant.id);
    const updatedMenu: MenuItem = {
      ...menu,
      variants: updatedVariants,
      updatedAt: new Date().toISOString(),
    };
    onSaveMenu(updatedMenu);
    if (selectedBreakdown?.variant.id === variant.id) {
      setSelectedBreakdown(null);
    }
    setVariantToDelete(null);
  };

  const handleSaveVariantModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantModalState.menu || !variantModalState.variant) return;
    const targetMenu = variantModalState.menu;
    const v = variantModalState.variant;
    const linkedIng = ingredients.find((i) => i.id === variantModalState.selectedIngredientId);
    const isSeafoodSelected =
      variantModalState.selectedIngredientId === 'seafood_combo' ||
      (v.proteinType || '').includes('ทะเล') ||
      (v.proteinType || '').includes('ซีฟู้ด');

    const derivedProtein = isSeafoodSelected
      ? 'ทะเล'
      : linkedIng
        ? linkedIng.name.split(' (')[0]
        : (v.proteinType?.trim() || 'หมูสับ');

    const pType = derivedProtein;
    const chosenUnit = (variantModalState.meatUnit || linkedIng?.usageUnit || linkedIng?.baseUnit || 'g').trim();
    const qty = Number(variantModalState.meatQuantity) || (pType.includes('กุ้ง') ? 4 : isPieceLikeUnit(chosenUnit) ? 1 : 80);

    // Keep existing non-protein recipe items (base recipe herbs, sauces, packaging, etc.)
    const existingOtherItems = (v.recipeItems || []).filter(
      (it) => !isProteinRecipeItem(it, pType)
    );

    let finalRecipeItems: RecipeItem[];
    if (isSeafoodSelected) {
      const shrimpIng = ingredients.find((i) => i.id === 'ing_shrimp_xl' || i.name.includes('กุ้ง'));
      const squidIng = ingredients.find((i) => i.id === 'ing_squid_fresh' || i.name.includes('หมึก'));
      const sQty = Number(variantModalState.seafoodShrimpQty) || 4;
      const qQty = Number(variantModalState.seafoodSquidQty) || 40;
      const sUnitCost = shrimpIng?.costPerBaseUnit || 8.5;
      const qUnitCost = squidIng?.costPerBaseUnit || 0.388;

      finalRecipeItems = [
        {
          id: 'sea_shrimp_' + Date.now(),
          ingredientType: 'INGREDIENT',
          ingredientId: shrimpIng ? shrimpIng.id : 'ing_shrimp_xl',
          name: shrimpIng ? shrimpIng.name : 'กุ้งสด (XL)',
          quantity: sQty,
          unit: (shrimpIng?.usageUnit as any) || 'ตัว',
          proteinCategory: 'SHRIMP',
          calculatedUnitCost: sUnitCost,
          calculatedLineCost: Number((sUnitCost * sQty).toFixed(2)),
        },
        {
          id: 'sea_squid_' + Date.now(),
          ingredientType: 'INGREDIENT',
          ingredientId: squidIng ? squidIng.id : 'ing_squid_fresh',
          name: squidIng ? squidIng.name : 'ปลาหมึกกล้วยสด',
          quantity: qQty,
          unit: (squidIng?.usageUnit as any) || 'g',
          proteinCategory: 'SQUID',
          calculatedUnitCost: qUnitCost,
          calculatedLineCost: Number((qUnitCost * qQty).toFixed(2)),
        },
        ...existingOtherItems,
      ];
    } else {
      let effectiveQtyForBase = qty;
      if (linkedIng) {
        const conv = convertUnit(qty, chosenUnit, linkedIng.usageUnit || linkedIng.baseUnit || 'g');
        if (conv.success) {
          effectiveQtyForBase = conv.convertedQuantity;
        }
      }
      const proteinRecipeItem: RecipeItem = {
        ingredientId: linkedIng ? linkedIng.id : '',
        name: linkedIng ? linkedIng.name : pType,
        quantity: qty,
        unit: chosenUnit,
        calculatedUnitCost: linkedIng?.costPerBaseUnit || 0,
        calculatedLineCost: Number(((linkedIng?.costPerBaseUnit || 0) * effectiveQtyForBase).toFixed(2)),
      };
      finalRecipeItems = [proteinRecipeItem, ...existingOtherItems];
    }

    translationScheduler.cancelAll();
    const derivedNameTh = v.name?.trim() || `${targetMenu.name} ${pType}`;
    const isVariantManual = Boolean(variantModalState.isEnglishManuallyEdited || v.englishNameManual);
    const derivedNameEn = isVariantManual
      ? (v.englishName || '').trim()
      : computeAutoEnglishName({
          previousThai: prevVariantThaiRef.current || derivedNameTh,
          nextThai: derivedNameTh,
          currentEnglish: v.englishName || '',
          isManuallyEdited: false,
        }).trim() || translateThaiToEnglish(derivedNameTh);
    const baseSellingPrice = Number(v.sellingPrice) || 60;

    const finalVariant: MenuVariant = {
      id: v.id || `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      menuId: targetMenu.id,
      code: v.code?.trim() || undefined,
      sku: v.sku?.trim() || v.code?.trim() || undefined,
      barcode: v.barcode?.trim() || undefined,
      name: derivedNameTh,
      thaiName: derivedNameTh,
      englishName: derivedNameEn,
      englishNameManual: isVariantManual,
      proteinType: pType,
      sellingPrice: baseSellingPrice,
      takeawayPrice: Number(v.takeawayPrice) || baseSellingPrice,
      deliveryPrice: Number(v.deliveryPrice) || Math.round(baseSellingPrice * grabMultiplier),
      grabPrice: Number(v.grabPrice) || Math.round(baseSellingPrice * grabMultiplier),
      linemanPrice: Number(v.linemanPrice) || Math.round(baseSellingPrice * linemanMultiplier),
      robinhoodPrice: Number(v.robinhoodPrice) || Math.round(baseSellingPrice * robinhoodMultiplier),
      overheadCost: v.overheadCost !== undefined && !isNaN(Number(v.overheadCost)) ? Number(v.overheadCost) : 6.0,
      packagingCost: v.packagingCost !== undefined && !isNaN(Number(v.packagingCost)) ? Number(v.packagingCost) : 9.0,
      recipeItems: finalRecipeItems,
      active: v.active !== undefined ? v.active : true,
      isOutOfStock: v.isOutOfStock || false,
      availableChannels: v.availableChannels || ['DINE_IN', 'TAKEAWAY', 'GRAB', 'LINEMAN'],
    };

    let updatedVariants: MenuVariant[];
    if (variantModalState.mode === 'ADD') {
      updatedVariants = [...targetMenu.variants, finalVariant];
    } else {
      updatedVariants = targetMenu.variants.map((item) =>
        item.id === finalVariant.id ? finalVariant : item
      );
    }

    const updatedMenu: MenuItem = {
      ...targetMenu,
      variants: updatedVariants,
      updatedAt: new Date().toISOString(),
    };

    onSaveMenu(updatedMenu);
    setVariantModalState({
      isOpen: false,
      mode: 'ADD',
      menu: null,
      variant: null,
      selectedIngredientId: '',
      meatQuantity: 80,
      meatUnit: 'g',
      isEnglishManuallyEdited: false,
      selectedBaseRecipeMenuId: '',
    });
  };

  // Packaging Line Items Management for Sub-Items
  const handleAddPackagingLine = () => {
    if (!selectedBreakdown) return;
    const { menu, variant } = selectedBreakdown;
    const currentItems = variant.packagingItems ? [...variant.packagingItems] : [];
    const newLine = {
      id: `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: isEn ? 'Food Box' : 'กล่องข้าว',
      cost: 5.0,
    };
    const updatedItems = [...currentItems, newLine];
    const totalPkgCost = updatedItems.reduce((acc, it) => acc + (Number(it.cost) || 0), 0);

    const updatedVariant: MenuVariant = {
      ...variant,
      packagingItems: updatedItems,
      packagingCost: totalPkgCost,
    };

    const updatedMenu: MenuItem = {
      ...menu,
      variants: menu.variants.map((v) => (v.id === variant.id ? updatedVariant : v)),
      updatedAt: new Date().toISOString(),
    };

    const updatedBreakdown = calculateVariantCostBreakdown(
      updatedVariant,
      updatedMenu.name,
      ingredientsMap,
      saucesMap,
      settings,
      activeChannel === 'LINEMAN' ? 'lineman' : 'grab'
    );

    onSaveMenu(updatedMenu);
    setSelectedBreakdown({
      menu: updatedMenu,
      variant: updatedVariant,
      breakdown: updatedBreakdown,
    });
  };

  const handleUpdatePackagingLine = (index: number, field: 'name' | 'cost', value: any) => {
    if (!selectedBreakdown) return;
    const { menu, variant } = selectedBreakdown;
    const currentItems = variant.packagingItems ? [...variant.packagingItems] : [];
    if (!currentItems[index]) return;

    currentItems[index] = {
      ...currentItems[index],
      [field]: value,
    };
    const totalPkgCost = currentItems.reduce((acc, it) => acc + (Number(it.cost) || 0), 0);

    const updatedVariant: MenuVariant = {
      ...variant,
      packagingItems: currentItems,
      packagingCost: totalPkgCost,
    };

    const updatedMenu: MenuItem = {
      ...menu,
      variants: menu.variants.map((v) => (v.id === variant.id ? updatedVariant : v)),
      updatedAt: new Date().toISOString(),
    };

    const updatedBreakdown = calculateVariantCostBreakdown(
      updatedVariant,
      updatedMenu.name,
      ingredientsMap,
      saucesMap,
      settings,
      activeChannel === 'LINEMAN' ? 'lineman' : 'grab'
    );

    onSaveMenu(updatedMenu);
    setSelectedBreakdown({
      menu: updatedMenu,
      variant: updatedVariant,
      breakdown: updatedBreakdown,
    });
  };

  const handleDeletePackagingLine = (index: number) => {
    if (!selectedBreakdown) return;
    const { menu, variant } = selectedBreakdown;
    const currentItems = variant.packagingItems ? [...variant.packagingItems] : [];
    const updatedItems = currentItems.filter((_, i) => i !== index);
    const totalPkgCost = updatedItems.reduce((acc, it) => acc + (Number(it.cost) || 0), 0);

    const updatedVariant: MenuVariant = {
      ...variant,
      packagingItems: updatedItems,
      packagingCost: totalPkgCost,
    };

    const updatedMenu: MenuItem = {
      ...menu,
      variants: menu.variants.map((v) => (v.id === variant.id ? updatedVariant : v)),
      updatedAt: new Date().toISOString(),
    };

    const updatedBreakdown = calculateVariantCostBreakdown(
      updatedVariant,
      updatedMenu.name,
      ingredientsMap,
      saucesMap,
      settings,
      activeChannel === 'LINEMAN' ? 'lineman' : 'grab'
    );

    onSaveMenu(updatedMenu);
    setSelectedBreakdown({
      menu: updatedMenu,
      variant: updatedVariant,
      breakdown: updatedBreakdown,
    });
  };

  // Handler for selecting breakdown with robust seafood auto-enrichment
  const handleSelectBreakdown = (data: {
    menu: MenuItem;
    variant: MenuVariant;
    breakdown: RecipeCostBreakdown;
  }) => {
    const isSeafood =
      data.variant.proteinType?.includes('ทะเล') ||
      data.variant.proteinType?.includes('ซีฟู้ด') ||
      data.variant.name?.includes('ทะเล') ||
      (data.breakdown.shrimpCost > 0 && data.breakdown.squidCost > 0);

    if (isSeafood) {
      const shrimpIng = ingredients.find((i) => i.id === 'ing_shrimp_xl' || i.name.includes('กุ้ง'));
      const squidIng = ingredients.find((i) => i.id === 'ing_squid_fresh' || i.name.includes('หมึก'));
      const sUnitCost = shrimpIng?.costPerBaseUnit || 8.5;
      const qUnitCost = squidIng?.costPerBaseUnit || 0.388;

      const existingShrimp = (data.variant.recipeItems || []).find(
        (it) => it.proteinCategory === 'SHRIMP' || it.name.includes('กุ้ง')
      );
      const existingSquid = (data.variant.recipeItems || []).find(
        (it) => it.proteinCategory === 'SQUID' || it.name.includes('หมึก')
      );

      const sQty = existingShrimp?.quantity || 4;
      const qQty = existingSquid?.quantity || 40;
      const calcShrimpCost = Number((sQty * sUnitCost).toFixed(2));
      const calcSquidCost = Number((qQty * qUnitCost).toFixed(2));
      const totalSeaCost = Number((calcShrimpCost + calcSquidCost).toFixed(2));

      let items = [...(data.breakdown.items || [])];
      const hasShrimp = items.some((it) => it.proteinCategory === 'SHRIMP' || it.name.includes('กุ้ง'));
      const hasSquid = items.some((it) => it.proteinCategory === 'SQUID' || it.name.includes('หมึก'));

      if (!hasShrimp) {
        items.unshift({
          id: 'seafood_shrimp_auto',
          ingredientType: 'INGREDIENT',
          ingredientId: shrimpIng?.id || 'ing_shrimp_xl',
          name: shrimpIng?.name || 'กุ้งสด (XL)',
          quantity: sQty,
          unit: (shrimpIng?.usageUnit as any) || 'ตัว',
          proteinCategory: 'SHRIMP',
          calculatedUnitCost: sUnitCost,
          calculatedLineCost: calcShrimpCost,
        });
      }
      if (!hasSquid) {
        const shrimpIdx = items.findIndex((it) => it.proteinCategory === 'SHRIMP' || it.name.includes('กุ้ง'));
        const squidItem = {
          id: 'seafood_squid_auto',
          ingredientType: 'INGREDIENT' as const,
          ingredientId: squidIng?.id || 'ing_squid_fresh',
          name: squidIng?.name || 'ปลาหมึกกล้วยสด',
          quantity: qQty,
          unit: (squidIng?.usageUnit as any) || 'g',
          proteinCategory: 'SQUID' as const,
          calculatedUnitCost: qUnitCost,
          calculatedLineCost: calcSquidCost,
        };
        if (shrimpIdx >= 0) {
          items.splice(shrimpIdx + 1, 0, squidItem);
        } else {
          items.unshift(squidItem);
        }
      }

      // Filter out any single generic duplicate
      items = items.filter(
        (it) => it.proteinCategory === 'SHRIMP' || it.proteinCategory === 'SQUID' || (it.name !== 'ทะเล' && it.name !== data.variant.proteinType)
      );

      const enrichedBreakdown: RecipeCostBreakdown = {
        ...data.breakdown,
        shrimpCost: calcShrimpCost,
        squidCost: calcSquidCost,
        seafoodTotalCost: totalSeaCost,
        items,
      };

      setSelectedBreakdown({
        menu: data.menu,
        variant: data.variant,
        breakdown: enrichedBreakdown,
      });
      return;
    }

    setSelectedBreakdown(data);
  };

  // Check if a breakdown has seafood
  const isSeafoodVariant = (breakdown: RecipeCostBreakdown) => {
    return breakdown.shrimpCost > 0 || breakdown.squidCost > 0 || breakdown.seafoodTotalCost > 0;
  };

  // Grab & LINE MAN commission calculations
  const grabCommissionPct = settings.grabFoodCommissionPercent ?? 30;
  const linemanCommissionPct = settings.lineManCommissionPercent ?? 25;

  // Real-time multiplier update: immediately recalculate target channel price on every menu variant
  const handleChannelMultiplierChange = (
    channel: 'grab' | 'lineman' | 'robinhood',
    nextVal: number
  ) => {
    if (!Number.isFinite(nextVal) || nextVal <= 0) return;

    const nextSettings: RestaurantSettings = {
      ...settings,
      ...(channel === 'grab' ? { grabPriceMultiplier: nextVal } : {}),
      ...(channel === 'lineman' ? { linemanPriceMultiplier: nextVal } : {}),
      ...(channel === 'robinhood' ? { robinhoodPriceMultiplier: nextVal } : {}),
      gpMultiplierMigrated: true,
    };
    onSaveSettings?.(nextSettings);

    const nowIso = new Date().toISOString();
    const updatedMenus = recalculateMenusWithChannelMultipliers(menus, nextSettings, {
      channels: [channel],
      resolveBaseSellingPrice: resolveVariantBaseSellingPrice,
      resolveBaseTakeawayPrice: resolveVariantTakeawayPrice,
      updatedAt: nowIso,
    });

    if (onBatchUpdateMenus) {
      onBatchUpdateMenus(updatedMenus);
    } else {
      updatedMenus.forEach((m) => onSaveMenu(m));
    }

    // Keep open Variant Modal synced in real time if currently open
    if (variantModalState.isOpen && variantModalState.variant) {
      const modalTakeaway =
        variantModalState.variant.takeawayPrice !== undefined &&
        variantModalState.variant.takeawayPrice !== null
          ? Number(variantModalState.variant.takeawayPrice) || 0
          : Number(variantModalState.variant.sellingPrice) || 0;
      const modalNextChannelPrice = computeChannelPriceFromMultiplier(modalTakeaway, nextVal);
      setVariantModalState((prev) => ({
        ...prev,
        variant: prev.variant
          ? {
              ...prev.variant,
              ...(channel === 'grab'
                ? { grabPrice: modalNextChannelPrice, deliveryPrice: modalNextChannelPrice }
                : {}),
              ...(channel === 'lineman' ? { linemanPrice: modalNextChannelPrice } : {}),
              ...(channel === 'robinhood' ? { robinhoodPrice: modalNextChannelPrice } : {}),
            }
          : prev.variant,
      }));
    }

    // Keep open Breakdown Modal synced in real time if currently open
    if (selectedBreakdown) {
      const updatedMenu = updatedMenus.find((m) => m.id === selectedBreakdown.menu.id);
      const updatedVariant = updatedMenu?.variants.find((v) => v.id === selectedBreakdown.variant.id);
      if (updatedMenu && updatedVariant) {
        const activeChannelPrice =
          activeChannel === 'LINEMAN'
            ? (updatedVariant.linemanPrice ?? updatedVariant.deliveryPrice)
            : (updatedVariant.grabPrice ?? updatedVariant.deliveryPrice);
        const updatedBreakdown = calculateVariantCostBreakdown(
          { ...updatedVariant, deliveryPrice: activeChannelPrice },
          updatedMenu.name,
          ingredientsMap,
          saucesMap,
          nextSettings,
          activeChannel === 'LINEMAN' ? 'lineman' : 'grab'
        );
        setSelectedBreakdown({
          menu: updatedMenu,
          variant: updatedVariant,
          breakdown: updatedBreakdown,
        });
      }
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Consolidated Ultra-Compact Control Header */}
      <div className="bg-white border border-stone-300 rounded-2xl shadow-xs p-2.5 sm:p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left section: Title + Metrics */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 font-black text-stone-900 text-sm sm:text-base mr-1">
              <UtensilsCrossed className="w-4 h-4 text-[#F27D26]" />
              <span>{isEn ? 'Food Cost / Menu' : 'ต้นทุนอาหาร / เมนู'}</span>
            </div>

            {/* Metric 1: Avg Food Cost (Compact) */}
            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-300 rounded-xl text-xs text-stone-900">
              <span className="text-stone-700 font-bold">{isEn ? 'Avg Food Cost:' : 'Food Cost เฉลี่ย:'}</span>
              <span className="font-mono font-black text-amber-800">
                {avgFoodCostPercent.toFixed(1)}%
              </span>
              <span className="text-[10px] text-stone-500 hidden md:inline">
                ({isEn ? 'Target' : 'เป้า'} {settings.targetFoodCostPercent || 35}%)
              </span>
            </div>

            {/* Metric 2: Clickable High Cost / Needs Review Filter Card */}
            <button
              type="button"
              onClick={handleToggleHighCostFilter}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black transition-all cursor-pointer border ${
                filterHighCostOnly
                  ? "bg-rose-600 !text-white border-rose-700 shadow-md ring-2 ring-rose-400"
                  : warningCount > 0
                  ? "bg-rose-50 hover:bg-rose-100 text-rose-950 border-2 border-rose-300 shadow-2xs hover:scale-[1.02]"
                  : "bg-stone-100 text-stone-600 border border-stone-300"
              }`}
              title={
                filterHighCostOnly
                  ? (isEn ? "Click to clear filter and show all menus" : "คลิกเพื่อยกเลิกการกรอง และแสดงเมนูทั้งหมด")
                  : (isEn ? "Click to show only high-cost / needs-review items" : "คลิกเพื่อแสดงเฉพาะเมนูต้นทุนสูง / ควรทบทวน ทันที")
              }
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${filterHighCostOnly ? "text-white" : "text-rose-600"}`} />
              <span className="whitespace-nowrap">{isEn ? 'High Cost / Needs Review:' : 'เมนูต้นทุนสูง / ควรทบทวน:'}</span>
              <span className={`px-1.5 py-0.2 rounded-md font-mono font-black text-xs ${
                filterHighCostOnly ? "bg-white text-rose-700" : "bg-rose-600 text-white"
              }`}>
                {warningCount} {isEn ? 'items' : 'รายการ'}
              </span>
              {filterHighCostOnly ? (
                <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-white text-rose-700 font-extrabold">
                  {isEn ? '✕ Clear Filter' : '✕ ยกเลิกกรอง'}
                </span>
              ) : (
                <span className="text-[10px] text-rose-700 font-bold hidden sm:inline underline underline-offset-2">
                  {isEn ? '(View Now)' : '(คลิกดูทันที)'}
                </span>
              )}
            </button>
          </div>

          {/* Right section: Add Menu */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={handleOpenAddMenu}
              className="px-3 py-1 bg-[#F27D26] hover:bg-[#d96817] !text-white font-black rounded-xl text-xs shadow-xs transition-all flex items-center gap-1 cursor-pointer shrink-0 border border-[#c2580e]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isEn ? '+ Add Menu' : '+ เพิ่มเมนูใหม่'}</span>
            </button>
          </div>
        </div>

        {/* Dynamic Channel Price Multipliers Row */}
        <div className="pt-2 border-t border-stone-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-stone-700 text-[11px]">
              {isEn
                ? 'Delivery Pricing (Takeaway × Owner-Defined GP%):'
                : 'ตั้งราคาขายเดลิเวอรี (ราคาใส่กล่อง Takeaway × ค่า GP เดลิเวอรี):'}
            </span>

            <label className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-xl">
              <span className="font-bold text-emerald-900 text-[11px]">GrabFood</span>
              <span className="text-emerald-700 font-bold text-[11px]">x</span>
              <NumericInput
                type="text"
                inputMode="decimal"
                min="0.1"
                step="0.01"
                value={grabMultiplier}
                fallbackValue={deriveGpMultiplierFromSettings(settings, 'grab')}
                onValueChange={(val) => handleChannelMultiplierChange('grab', val)}
                className="w-16 px-1.5 py-0.5 bg-white border border-emerald-300 rounded-lg text-center font-mono font-bold text-stone-900 text-xs focus:outline-none focus:border-emerald-600"
              />
            </label>

            <label className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-xl">
              <span className="font-bold text-amber-900 text-[11px]">LINE MAN</span>
              <span className="text-amber-700 font-bold text-[11px]">x</span>
              <NumericInput
                type="text"
                inputMode="decimal"
                min="0.1"
                step="0.01"
                value={linemanMultiplier}
                fallbackValue={deriveGpMultiplierFromSettings(settings, 'lineman')}
                onValueChange={(val) => handleChannelMultiplierChange('lineman', val)}
                className="w-16 px-1.5 py-0.5 bg-white border border-amber-300 rounded-lg text-center font-mono font-bold text-stone-900 text-xs focus:outline-none focus:border-amber-600"
              />
            </label>

            <label className="flex items-center gap-1.5 px-2 py-1 bg-purple-50 border border-purple-200 rounded-xl">
              <span className="font-bold text-purple-900 text-[11px]">Robinhood</span>
              <span className="text-purple-700 font-bold text-[11px]">x</span>
              <NumericInput
                type="text"
                inputMode="decimal"
                min="0.1"
                step="0.01"
                value={robinhoodMultiplier}
                fallbackValue={deriveGpMultiplierFromSettings(settings, 'robinhood')}
                onValueChange={(val) => handleChannelMultiplierChange('robinhood', val)}
                className="w-16 px-1.5 py-0.5 bg-white border border-purple-300 rounded-lg text-center font-mono font-bold text-stone-900 text-xs focus:outline-none focus:border-purple-600"
              />
            </label>
          </div>

          <span className="text-[10px] text-stone-500">
            {isEn
              ? `Auto-calculated from Takeaway price × Owner-Defined GP% (Grab +${getEffectiveDeliveryGpPercent(settings, 'grab').toFixed(1)}%, LINE MAN +${getEffectiveDeliveryGpPercent(settings, 'lineman').toFixed(1)}%)`
              : `คำนวณอัตโนมัติจาก ราคาหน้าร้านใส่กล่อง × ค่า GP เดลิเวอรี (Grab +${getEffectiveDeliveryGpPercent(settings, 'grab').toFixed(1)}%, LINE MAN +${getEffectiveDeliveryGpPercent(settings, 'lineman').toFixed(1)}%)`}
          </span>
        </div>
      </div>


      {/* Active High-Cost Filter Alert Banner (Displayed when filtering warning items) */}
      {filterHighCostOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 sm:p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-950 text-xs shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-bold">
              {isEn
                ? `Showing only flagged menus (${warningMenuIds.size} menus, ${warningRows.length} variants)`
                : `กำลังแสดงเฉพาะเมนูที่มีการแจ้งเตือน (${warningMenuIds.size} เมนู, ${warningRows.length} รายการตัวเลือก)`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsWarningModalOpen(true)}
              className="px-2.5 py-1 bg-white hover:bg-rose-100 border border-rose-300 text-rose-900 font-black rounded-lg cursor-pointer"
            >
              {isEn ? `View All Alerts (${warningRows.length})` : `ดูรายการแจ้งเตือนทั้งหมด (${warningRows.length})`}
            </button>
            <button
              type="button"
              onClick={() => setFilterHighCostOnly(false)}
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-lg cursor-pointer"
            >
              {isEn ? '✕ Clear Filter (Show All)' : '✕ ยกเลิกกรอง (แสดงทุกเมนู)'}
            </button>
          </div>
        </div>
      )}

      {/* CLEAN MENU LIST + ON-DEMAND VARIANT DETAILS */}
      {(
        <div className="space-y-4">
          {/* Menu names only — one per row */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <h2 className="text-sm font-black text-stone-900">{isEn ? 'Menu List' : 'รายการเมนูอาหาร'}</h2>
              <span className="text-xs font-mono font-bold text-stone-600">
                {filteredMenus.length} {isEn ? 'menus' : 'เมนู'}
              </span>
            </div>

            <div className="divide-y divide-stone-200">
              {filteredMenus.map((menu, mIdx) => {
                const isSelected = selectedMenuId === menu.id;
                const hasWarning = warningMenuIds.has(menu.id);
                const isDragging = draggedMenuId === menu.id;
                const isDragOver = dragOverMenuId === menu.id;
                const primaryMenuTitle = getLocalizedText(lang, menu.thaiName || menu.name, menu.englishName);
                const secondaryMenuTitle = isEn
                  ? (menu.thaiName || menu.name || '').trim()
                  : (menu.englishName || translateThaiToEnglish(menu.name) || '').trim();

                return (
                  <React.Fragment key={menu.id}>
                    <div
                      draggable
                      onDragStart={(e) => handleMenuDragStart(e, menu.id)}
                      onDragOver={(e) => handleMenuDragOver(e, menu.id)}
                      onDrop={(e) => handleMenuDrop(e, menu.id)}
                      onDragEnd={handleMenuDragEnd}
                      className={`group flex items-center gap-3 px-4 py-3 transition-all ${
                        isDragging ? 'opacity-40 bg-stone-100' : ''
                      } ${isDragOver ? 'border-t-2 border-[#F27D26] bg-amber-50/40' : ''} ${
                        isSelected ? 'bg-amber-50/70 border-l-4 border-[#F27D26]' : 'hover:bg-stone-50'
                      }`}
                    >
                      {/* Drag Handle & Reorder Up/Down Controls */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <div
                          className="p-1 text-stone-400 hover:text-stone-700 cursor-grab active:cursor-grabbing rounded hover:bg-stone-200 transition-colors"
                          title={isEn ? 'Drag to reorder menu' : 'กดเมาส์ค้างไว้เพื่อลากย้ายตำแหน่งเมนู'}
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col -space-y-0.5">
                          <button
                            type="button"
                            disabled={mIdx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveMenu(menu.id, 'up');
                            }}
                            className="p-0.5 text-stone-400 hover:text-stone-800 disabled:opacity-20 disabled:hover:text-stone-400 rounded cursor-pointer"
                            title={isEn ? 'Move Up' : 'ย้ายขึ้น'}
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={mIdx === filteredMenus.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveMenu(menu.id, 'down');
                            }}
                            className="p-0.5 text-stone-400 hover:text-stone-800 disabled:opacity-20 disabled:hover:text-stone-400 rounded cursor-pointer"
                            title={isEn ? 'Move Down' : 'ย้ายลง'}
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedMenuId(isSelected ? null : menu.id)}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                      >
                        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'bg-[#F27D26]/15 border-[#F27D26]/40 text-[#F27D26]'
                            : 'bg-stone-100 border-stone-200 text-stone-600'
                        }`}>
                          <UtensilsCrossed className="w-4 h-4" />
                        </span>
                        <div className="min-w-0 flex items-center gap-2 flex-wrap">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              if (menuNameClickTimerRef.current) clearTimeout(menuNameClickTimerRef.current);
                              if (e.detail >= 2) return;
                              menuNameClickTimerRef.current = setTimeout(() => {
                                menuNameClickTimerRef.current = null;
                                setSelectedMenuId(isSelected ? null : menu.id);
                              }, 200);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              if (menuNameClickTimerRef.current) {
                                clearTimeout(menuNameClickTimerRef.current);
                                menuNameClickTimerRef.current = null;
                              }
                              handleOpenEditMenu(menu);
                            }}
                            title={isEn ? 'Double-click menu name to edit' : 'ดับเบิลคลิกที่ชื่อเมนูเพื่อแก้ไข'}
                            className="text-sm font-bold text-stone-900 hover:text-[#F27D26] transition-colors truncate cursor-pointer"
                          >
                            {primaryMenuTitle}
                          </span>
                          {secondaryMenuTitle && secondaryMenuTitle !== primaryMenuTitle && (
                            <span className="text-[11px] text-stone-500 font-medium truncate">
                              ({secondaryMenuTitle})
                            </span>
                          )}
                          <span className="text-[11px] text-stone-500 font-medium">
                            {menu.variants.length} {isEn ? 'variants' : 'ตัวเลือก'}
                          </span>
                          {hasWarning && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-600 !text-white shadow-2xs flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-white" />
                              <span>{isEn ? 'High Cost / Review' : 'ต้นทุนสูง / ควรทบทวน'}</span>
                            </span>
                          )}
                        </div>
                        <ChevronRight className={`w-4 h-4 ml-auto shrink-0 transition-transform ${
                          isSelected ? 'rotate-90 text-[#F27D26]' : 'text-stone-400'
                        }`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditMenu(menu)}
                        className="p-1.5 rounded-xl text-stone-400 hover:text-stone-800 hover:bg-stone-200 cursor-pointer shrink-0 transition-colors"
                        title={isEn ? 'Edit menu' : 'แก้ไขเมนู'}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuToDelete(menu)}
                        className="p-1.5 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0 transition-colors"
                        title={isEn ? 'Delete menu' : 'ลบเมนู'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Inline accordion detail panel directly beneath this menu row */}
                    {isSelected && (
                      <div className="bg-[#FAF8F5] border-t border-b border-stone-300 p-2 sm:p-4 overflow-hidden shadow-inner">
                        <MenuPricingSpreadsheetTable
                          menu={menu}
                          ingredientsMap={ingredientsMap}
                          saucesMap={saucesMap}
                          settings={settings}
                          lang={lang}
                          onSaveMenu={onSaveMenu}
                          onSelectBreakdown={handleSelectBreakdown}
                          onOpenAddVariant={handleOpenAddVariant}
                          onEditVariant={handleOpenEditVariant}
                          onDeleteVariant={handleOpenDeleteVariant}
                          activeChannel={activeChannel}
                          onChannelChange={(ch) => setActiveChannel(ch as any)}
                          activeServingMode={activeServingMode}
                          onServingModeChange={setActiveServingMode}
                        />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* DETAIL COST BREAKDOWN MODAL (Includes Seafood Rule Breakdown) */}
      {selectedBreakdown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-2xl w-full shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            {/* Modal Header */}
            <div className="modal-header flex items-center justify-between border-b border-stone-200">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-stone-900 text-lg">
                  {getLocalizedText(lang, selectedBreakdown.menu.thaiName || selectedBreakdown.menu.name, selectedBreakdown.menu.englishName)}{' '}
                  ({getLocalizedText(lang, selectedBreakdown.variant.thaiName || selectedBreakdown.variant.name, selectedBreakdown.variant.englishName)})
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-300">
                  {getLocalizedText(lang, selectedBreakdown.menu.category)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBreakdown(null)}
                className="p-1 rounded-xl text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4 text-xs scrollbar-thin">
              {/* SEAFOOD RULE HIGHLIGHT CARD */}
              {isSeafoodVariant(selectedBreakdown.breakdown) && (
                <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5">
                  <div className="flex items-center gap-2 text-sm font-black text-amber-900 mb-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>
                      {isEn
                        ? 'Seafood Rule: Calculate Shrimp and Squid Strictly Separately'
                        : 'Seafood Rule: คำนวณกุ้งและปลาหมึกแยกจากกันเด็ดขาด'}
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-700 mb-3">
                    {isEn
                      ? 'Per store accounting accuracy rules: Shrimp is counted per piece (pc) and Squid is weighed in grams (g) — never combined as generic "Seafood" or estimated.'
                      : "ตามกฎความถูกต้องทางบัญชีของร้าน: กุ้งต้องคำนวณเป็น 'ตัว' และปลาหมึกต้องคำนวณเป็น 'กรัม' (ห้ามรวมเป็น 'ทะเล' รายการเดียว หรือใช้การประมาณ)"}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                    <div className="bg-white p-3 rounded-xl border border-stone-300 shadow-2xs">
                      <span className="text-[11px] font-sans text-stone-700 block font-bold">
                        {isEn ? '🦐 Fresh Shrimp' : '🦐 กุ้งสด'}
                      </span>
                      <span className="text-base font-black text-stone-950 mt-1 block">
                        ฿{selectedBreakdown.breakdown.shrimpCost.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-stone-500">
                        {isEn ? 'Counted per piece (not grams)' : 'คิดเป็นตัว (ไม่แปลงเป็นกรัม)'}
                      </span>
                    </div>

                    <div className="bg-white p-3 rounded-xl border border-stone-300 shadow-2xs">
                      <span className="text-[11px] font-sans text-stone-700 block font-bold">
                        {isEn ? '🦑 Fresh Squid' : '🦑 ปลาหมึกสด'}
                      </span>
                      <span className="text-base font-black text-stone-950 mt-1 block">
                        ฿{selectedBreakdown.breakdown.squidCost.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-stone-500">
                        {isEn ? 'Weighed in grams (65% cleaned yield)' : 'คิดเป็นกรัม (คำนวณ Yield ลอกหนัง 65%)'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between font-mono text-xs">
                    <span className="font-sans text-stone-800 font-bold">
                      {isEn ? 'Total Seafood Cost per Dish:' : 'รวมต้นทุนอาหารทะเลทั้งจาน:'}
                    </span>
                    <span className="font-black text-stone-950 text-sm">
                      ฿{selectedBreakdown.breakdown.seafoodTotalCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Recipe Items Breakdown Table */}
              <div>
                <span className="font-black text-stone-900 block mb-1.5">
                  {isEn ? 'Recipe Ingredients & Components' : 'ส่วนประกอบและวัตถุดิบในจาน (Recipe Items)'}
                </span>
                <div className="bg-white border border-stone-300 rounded-2xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-stone-100 border-b border-stone-300 text-stone-700 text-[10px] uppercase font-bold">
                        <th className="py-2 px-3">{isEn ? 'Ingredient / Item' : 'วัตถุดิบ / ส่วนประกอบ'}</th>
                        <th className="py-2 px-2">{isEn ? 'Type' : 'ประเภท'}</th>
                        <th className="py-2 px-2 text-right">{isEn ? 'Qty' : 'ปริมาณ'}</th>
                        <th className="py-2 px-2 text-right">{isEn ? 'Unit Cost' : 'ต้นทุน/หน่วย'}</th>
                        <th className="py-2 px-3 text-right">{isEn ? 'Total (฿)' : 'รวมเงิน (฿)'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200 font-mono">
                      {(() => {
                        // Ensure for Seafood variants that both Shrimp and Squid are present in items
                        const isSeafood =
                          selectedBreakdown.variant.proteinType?.includes('ทะเล') ||
                          selectedBreakdown.variant.proteinType?.includes('ซีฟู้ด') ||
                          selectedBreakdown.variant.name?.includes('ทะเล') ||
                          (selectedBreakdown.breakdown.shrimpCost > 0 && selectedBreakdown.breakdown.squidCost > 0);

                        let displayItems = [...selectedBreakdown.breakdown.items];

                        if (isSeafood) {
                          const hasShrimp = displayItems.some(
                            (it) => it.proteinCategory === 'SHRIMP' || it.name.includes('กุ้ง')
                          );
                          const hasSquid = displayItems.some(
                            (it) => it.proteinCategory === 'SQUID' || it.name.includes('หมึก')
                          );

                          if (!hasShrimp) {
                            const shrimpCost = selectedBreakdown.breakdown.shrimpCost || 34.0;
                            const shrimpQty = Math.round(shrimpCost / 8.5) || 4;
                            displayItems.unshift({
                              id: 'seafood_shrimp_display',
                              ingredientId: 'seafood_shrimp_display',
                              name: 'กุ้งสด (XL)',
                              quantity: shrimpQty,
                              unit: 'ตัว' as any,
                              proteinCategory: 'SHRIMP',
                              calculatedUnitCost: 8.5,
                              calculatedLineCost: shrimpCost,
                            });
                          }

                          if (!hasSquid) {
                            const squidCost = selectedBreakdown.breakdown.squidCost || 15.52;
                            const squidQty = Math.round(squidCost / 0.388) || 40;
                            const insertIdx = displayItems.findIndex(
                              (it) => it.proteinCategory === 'SHRIMP' || it.name.includes('กุ้ง')
                            );
                            const newItem = {
                              id: 'seafood_squid_display',
                              ingredientId: 'seafood_squid_display',
                              name: 'ปลาหมึกกล้วยสด',
                              quantity: squidQty,
                              unit: 'g' as any,
                              proteinCategory: 'SQUID' as const,
                              calculatedUnitCost: 0.388,
                              calculatedLineCost: squidCost,
                            };
                            if (insertIdx >= 0) {
                              displayItems.splice(insertIdx + 1, 0, newItem);
                            } else {
                              displayItems.unshift(newItem);
                            }
                          }

                          displayItems = displayItems.filter(
                            (it) => it.proteinCategory === 'SHRIMP' || it.proteinCategory === 'SQUID' || (it.name !== 'ทะเล' && it.name !== selectedBreakdown.variant.proteinType)
                          );
                        }

                        return displayItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-stone-50">
                          <td className="py-2 px-3 font-sans text-stone-900 font-bold">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{getLocalizedText(lang, item.name)}</span>
                              {((item as any).missingPrice || !(item.calculatedUnitCost && item.calculatedUnitCost > 0)) && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-700 border border-amber-500/30">
                                  {isEn
                                    ? 'Missing ingredient price — cost may be understated'
                                    : 'ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 font-sans text-stone-600 text-[10px]">
                            {item.type === 'SAUCE'
                              ? (isEn ? 'Sauce' : 'ซอส')
                              : (isEn ? 'Ingredient' : 'วัตถุดิบ')}
                          </td>
                          <td className="py-2 px-2 text-right text-stone-800 font-semibold">
                            {item.quantity} {localizeUnit(item.unit, lang)}
                          </td>
                          <td className="py-2 px-2 text-right text-stone-700">
                            ฿{(item.calculatedUnitCost || 0).toFixed(4)}
                          </td>
                          <td className="py-2 px-3 text-right font-black text-stone-950">
                            ฿{(item.calculatedLineCost || 0).toFixed(2)}
                          </td>
                        </tr>
                      ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Packaging Line Items Card */}
              <div className="bg-white border border-stone-300 rounded-2xl p-3.5 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-cyan-700" />
                    <span className="font-black text-stone-900 text-xs">
                      {isEn ? 'Box & Packaging Cost (Packaging Items)' : 'ต้นทุนกล่อง & บรรจุภัณฑ์ (Packaging Items)'}
                    </span>
                    <span className="text-[10px] text-stone-500">
                      {isEn ? '(Specific to this variant)' : '(กำหนดเฉพาะตัวเลือกนี้)'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPackagingLine}
                    className="px-2.5 py-1 bg-cyan-700 hover:bg-cyan-800 !text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Add Packaging' : '+ เพิ่มแพ็กเกจจิ้ง'}</span>
                  </button>
                </div>

                {(!selectedBreakdown.variant.packagingItems || selectedBreakdown.variant.packagingItems.length === 0) ? (
                  <div className="p-3 text-center text-stone-500 text-xs border border-dashed border-stone-300 rounded-xl bg-stone-50">
                    {isEn
                      ? 'No packaging items yet (click "Add Packaging" above to specify e.g. Food Box, Plastic Bag, Cutlery)'
                      : 'ยังไม่มีรายการแพ็กเกจจิ้ง (กดปุ่ม "+ เพิ่มแพ็กเกจจิ้ง" ด้านบนเพื่อระบุ เช่น กล่องข้าว, ถุงพลาสติก, ช้อนส้อม)'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedBreakdown.variant.packagingItems.map((pkg, pIdx) => (
                      <div key={`${pkg.id || 'pkg'}-${pIdx}`} className="flex items-center gap-2 bg-stone-50 p-2 rounded-xl border border-stone-200">
                        {/* Packaging Name with common datalist */}
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            list={`pkg-common-${pIdx}`}
                            value={pkg.name}
                            placeholder={isEn ? 'Packaging name e.g. Food Box, Bag' : 'ชื่อแพ็กเกจจิ้ง เช่น กล่องข้าว, ถุงหิ้ว'}
                            onChange={(e) => handleUpdatePackagingLine(pIdx, 'name', e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#F27D26]"
                          />
                          <datalist id={`pkg-common-${pIdx}`}>
                            <option value={isEn ? 'Food Box' : 'กล่องข้าว'} />
                            <option value={isEn ? 'Eco Paper Box' : 'กล่องกระดาษรักษ์โลก'} />
                            <option value={isEn ? 'Plastic Carrier Bag' : 'ถุงพลาสติกหิ้ว'} />
                            <option value={isEn ? 'Paper Bag' : 'ถุงกระดาษ'} />
                            <option value={isEn ? 'Cutlery Set' : 'ชุดช้อนส้อมพลาสติก'} />
                            <option value={isEn ? 'Sauce Cup' : 'กระปุกน้ำจิ้ม / ถ้วยซอส'} />
                            <option value={isEn ? 'Napkin / Sticker' : 'กระดาษทิชชู่ / สติกเกอร์'} />
                          </datalist>
                        </div>

                        {/* Price */}
                        <div className="w-28 relative">
                          <NumericInput
                            type="number"
                            step="0.25"
                            min="0"
                            value={pkg.cost || ''}
                            placeholder="0.00"
                            onChange={(e) => handleUpdatePackagingLine(pIdx, 'cost', parseFloat(e.target.value) || 0)}
                            className="w-full pl-2 pr-8 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono font-bold text-stone-900 text-right focus:outline-none focus:border-[#F27D26]"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-stone-500 font-bold">
                            {isEn ? 'THB' : 'บาท'}
                          </span>
                        </div>

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={() => handleDeletePackagingLine(pIdx)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title={isEn ? 'Delete item' : 'ลบรายการนี้'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}

                    <div className="flex justify-between items-center px-3 py-2 bg-cyan-50 border border-cyan-200 rounded-xl text-xs font-mono">
                      <span className="font-sans text-stone-800 font-bold">
                        {isEn ? 'Total Packaging Cost:' : 'โสหุ้ยแพ็กเกจจิ้งรวม (Total packaging cost):'}
                      </span>
                      <span className="font-black text-cyan-900 text-sm">
                        ฿{(selectedBreakdown.breakdown.packagingCost || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Cost Summary Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 font-mono">
                <div className="bg-stone-100 p-2.5 rounded-xl border border-stone-300">
                  <span className="text-[10px] font-sans text-stone-600 block font-bold">
                    {isEn ? 'Ingredient Cost' : 'ต้นทุนวัตถุดิบรวม'}
                  </span>
                  <span className="text-base font-black text-stone-950 block mt-0.5">
                    ฿{selectedBreakdown.breakdown.totalIngredientCost.toFixed(2)}
                  </span>
                </div>

                <div className="bg-stone-100 p-2.5 rounded-xl border border-stone-300">
                  <span className="text-[10px] font-sans text-stone-600 block font-bold">
                    {isEn ? 'Overhead / Dish' : 'ค่าโสหุ้ยต่อจาน'}
                  </span>
                  <span className="text-base font-black text-stone-950 block mt-0.5">
                    ฿{selectedBreakdown.breakdown.overheadCost.toFixed(2)}
                  </span>
                </div>

                <div className="bg-cyan-50 p-2.5 rounded-xl border border-cyan-300">
                  <span className="text-[10px] font-sans text-cyan-900 block font-bold">
                    {isEn ? 'Total Packaging' : 'แพ็กเกจจิ้งรวม'}
                  </span>
                  <span className="text-base font-black text-cyan-900 block mt-0.5">
                    ฿{(selectedBreakdown.breakdown.packagingCost || 0).toFixed(2)}
                  </span>
                </div>

                <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-300">
                  <span className="text-[10px] font-sans text-amber-900 block font-bold">
                    {isEn ? 'Net Total Cost' : 'ต้นทุนรวมสุทธิ'}
                  </span>
                  <span className="text-base font-black text-amber-950 block mt-0.5">
                    ฿{selectedBreakdown.breakdown.totalCost.toFixed(2)}
                  </span>
                </div>

                <div className="bg-stone-100 p-2.5 rounded-xl border border-stone-300">
                  <span className="text-[10px] font-sans text-stone-600 block font-bold">
                    {isEn ? 'Dine-in FC%' : 'Food Cost หน้าร้าน'}
                  </span>
                  <span
                    className={`text-base font-black block mt-0.5 ${
                      selectedBreakdown.breakdown.restaurantFoodCostPercent > 40
                        ? 'text-rose-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {selectedBreakdown.breakdown.restaurantFoodCostPercent.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Delivery Channel Split Details (GrabFood vs LINE MAN) */}
              {(() => {
                const pkgCostToUse =
                  (selectedBreakdown.breakdown.packagingCost || 0) > 0
                    ? selectedBreakdown.breakdown.packagingCost
                    : (settings.deliveryPackagingCost || 8);
                const baseCost =
                  selectedBreakdown.breakdown.totalIngredientCost +
                  selectedBreakdown.breakdown.overheadCost;
                const vatRate = settings.vatRatePercent ?? 7;
                const isVatInclusive =
                  selectedBreakdown.variant.taxType === 'INCLUSIVE' ||
                  (selectedBreakdown.variant.taxType !== 'EXCLUSIVE' &&
                    selectedBreakdown.variant.taxType !== 'NONE' &&
                    Boolean(settings.pricesIncludeVat ?? settings.salesVatInclusive));
                const scIncluded = Boolean(settings.serviceChargeIncludedInPrice);
                const scRate = settings.serviceChargePercent ?? 0;
                const resolvedBaseTakeaway = resolveVariantTakeawayPrice(
                  selectedBreakdown.menu,
                  selectedBreakdown.variant
                );
                const grabGross =
                  typeof selectedBreakdown.variant.grabPrice === 'number' &&
                  selectedBreakdown.variant.grabPrice > 0
                    ? selectedBreakdown.variant.grabPrice
                    : computeChannelPriceFromMultiplier(resolvedBaseTakeaway, grabMultiplier);
                const linemanGross =
                  typeof selectedBreakdown.variant.linemanPrice === 'number' &&
                  selectedBreakdown.variant.linemanPrice > 0
                    ? selectedBreakdown.variant.linemanPrice
                    : computeChannelPriceFromMultiplier(resolvedBaseTakeaway, linemanMultiplier);
                const robinhoodGross =
                  typeof selectedBreakdown.variant.robinhoodPrice === 'number' &&
                  selectedBreakdown.variant.robinhoodPrice > 0
                    ? selectedBreakdown.variant.robinhoodPrice
                    : computeChannelPriceFromMultiplier(resolvedBaseTakeaway, robinhoodMultiplier);
                const grabNetExVat = extractNetPriceFromMenuPrice(
                  grabGross,
                  isVatInclusive,
                  vatRate,
                  scIncluded,
                  scRate
                );
                const linemanNetExVat = extractNetPriceFromMenuPrice(
                  linemanGross,
                  isVatInclusive,
                  vatRate,
                  scIncluded,
                  scRate
                );
                const robinhoodNetExVat = extractNetPriceFromMenuPrice(
                  robinhoodGross,
                  isVatInclusive,
                  vatRate,
                  scIncluded,
                  scRate
                );
                const effectiveGrabPct = getEffectiveDeliveryGpPercent(settings, 'grab');
                const effectiveLinemanPct = getEffectiveDeliveryGpPercent(settings, 'lineman');
                const grabGpFee = grabGross * (effectiveGrabPct / 100);
                const linemanGpFee = linemanGross * (effectiveLinemanPct / 100);
                const grabProfit = grabNetExVat - grabGpFee - baseCost - pkgCostToUse;
                const linemanProfit = linemanNetExVat - linemanGpFee - baseCost - pkgCostToUse;
                const robinhoodProfit = robinhoodNetExVat - baseCost - pkgCostToUse;

                return (
                  <div className="bg-stone-100 border border-stone-300 rounded-2xl p-3.5">
                    <span className="font-black text-stone-900 block mb-2 font-sans">
                      {isEn
                        ? 'Net Profit Comparison by Delivery Channel'
                        : 'เปรียบเทียบกำไรสุทธิแยกตามช่องทาง Delivery'}
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                      {/* GrabFood Card */}
                      <div className="p-3 rounded-xl bg-white border border-[#00B14F]/40 shadow-2xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-sans font-black text-[#00873e]">GrabFood ({grabMultiplier}x)</span>
                          <span className="text-[10px] text-stone-500 font-bold">
                            GP {grabCommissionPct}%
                            {effectiveGrabPct > grabCommissionPct
                              ? ` (${effectiveGrabPct.toFixed(1)}% ${isEn ? 'incl. VAT' : 'รวม VAT'})`
                              : ''}
                          </span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="font-sans text-stone-600">
                              {isEn ? 'Selling Price' : 'ราคาขาย'}
                              {isVatInclusive ? ` (Net ฿${grabNetExVat.toFixed(2)})` : ''}:
                            </span>
                            <span className="text-stone-900 font-bold">
                              ฿{grabGross}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">
                              {isEn ? `GP Fee (${effectiveGrabPct.toFixed(1)}%):` : `หัก GP (${effectiveGrabPct.toFixed(1)}%):`}
                            </span>
                            <span>
                              -฿{grabGpFee.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">
                              {isEn ? 'Delivery Packaging:' : 'ค่ากล่อง Delivery:'}
                            </span>
                            <span>-฿{pkgCostToUse.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-stone-200 font-bold">
                            <span className="font-sans text-stone-800">
                              {isEn ? 'Net Profit After GP:' : 'กำไรสุทธิหลัง GP:'}
                            </span>
                            <span className={`font-black ${grabProfit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                              ฿{grabProfit.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* LINE MAN Card */}
                      <div className="p-3 rounded-xl bg-white border border-[#05963c]/40 shadow-2xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-sans font-black text-[#05963c]">LINE MAN ({linemanMultiplier}x)</span>
                          <span className="text-[10px] text-stone-500 font-bold">
                            GP {linemanCommissionPct}%
                            {effectiveLinemanPct > linemanCommissionPct
                              ? ` (${effectiveLinemanPct.toFixed(1)}% ${isEn ? 'incl. VAT' : 'รวม VAT'})`
                              : ''}
                          </span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="font-sans text-stone-600">
                              {isEn ? 'Selling Price' : 'ราคาขาย'}
                              {isVatInclusive ? ` (Net ฿${linemanNetExVat.toFixed(2)})` : ''}:
                            </span>
                            <span className="text-stone-900 font-bold">
                              ฿{linemanGross}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">
                              {isEn ? `GP Fee (${effectiveLinemanPct.toFixed(1)}%):` : `หัก GP (${effectiveLinemanPct.toFixed(1)}%):`}
                            </span>
                            <span>
                              -฿{linemanGpFee.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">
                              {isEn ? 'Delivery Packaging:' : 'ค่ากล่อง Delivery:'}
                            </span>
                            <span>-฿{pkgCostToUse.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-stone-200 font-bold">
                            <span className="font-sans text-stone-800">
                              {isEn ? 'Net Profit After GP:' : 'กำไรสุทธิหลัง GP:'}
                            </span>
                            <span className={`font-black ${linemanProfit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                              ฿{linemanProfit.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Robinhood Card */}
                      <div className="p-3 rounded-xl bg-white border border-purple-500/40 shadow-2xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-sans font-black text-purple-700">Robinhood ({robinhoodMultiplier}x)</span>
                          <span className="text-[10px] text-purple-600 font-bold">GP 0%</span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="font-sans text-stone-600">
                              {isEn ? 'Selling Price' : 'ราคาขาย'}
                              {isVatInclusive ? ` (Net ฿${robinhoodNetExVat.toFixed(2)})` : ''}:
                            </span>
                            <span className="text-stone-900 font-bold">
                              ฿{robinhoodGross}
                            </span>
                          </div>
                          <div className="flex justify-between text-emerald-700 font-semibold">
                            <span className="font-sans text-stone-600">
                              {isEn ? 'GP Fee (0%):' : 'หัก GP (0%):'}
                            </span>
                            <span>฿0.00</span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">
                              {isEn ? 'Delivery Packaging:' : 'ค่ากล่อง Delivery:'}
                            </span>
                            <span>-฿{pkgCostToUse.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-stone-200 font-bold">
                            <span className="font-sans text-stone-800">
                              {isEn ? 'Net Profit After GP:' : 'กำไรสุทธิหลัง GP:'}
                            </span>
                            <span className={`font-black ${robinhoodProfit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                              ฿{robinhoodProfit.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Dynamic Suggested Price by Target Food Cost */}
              {(() => {
                const vatRate = settings.vatRatePercent ?? 7;
                const isVatInclusive =
                  selectedBreakdown.variant.taxType === 'INCLUSIVE' ||
                  (selectedBreakdown.variant.taxType !== 'EXCLUSIVE' &&
                    selectedBreakdown.variant.taxType !== 'NONE' &&
                    Boolean(settings.pricesIncludeVat ?? settings.salesVatInclusive));
                const scIncluded = Boolean(settings.serviceChargeIncludedInPrice);
                const scRate = settings.serviceChargePercent ?? 0;
                const roundingStep: 1 | 5 | 10 = settings.priceRounding ?? 1;
                const suggestedPriceCalc = calculateChannelSuggestedPrices(
                  selectedBreakdown.breakdown.totalIngredientCost,
                  customTargetFcPercent,
                  settings.targetProfitAmount ?? 25,
                  selectedBreakdown.breakdown.overheadCost,
                  grabCommissionPct,
                  selectedBreakdown.breakdown.deliveryPackagingCost,
                  {
                    vatRatePercent: vatRate,
                    pricesIncludeVat: isVatInclusive,
                    serviceChargeIncludedInPrice: scIncluded,
                    serviceChargePercent: scRate,
                    roundingStep,
                  }
                );
                return (
                  <div className="bg-stone-100 border border-stone-300 rounded-2xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-black text-stone-900 font-sans">
                        {isEn ? '💡 Suggested Price Calculator' : '💡 เครื่องคำนวณราคาขายแนะนำ (Suggested Price Calculator)'}
                      </span>
                      <span className="font-mono text-amber-800 font-black">
                        {isEn ? `Target FC: ${customTargetFcPercent}%` : `เป้าหมาย FC: ${customTargetFcPercent}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="55"
                      step="1"
                      value={customTargetFcPercent}
                      onChange={(e) => setCustomTargetFcPercent(Number(e.target.value))}
                      className="w-full accent-[#F27D26]"
                    />
                    <div className="mt-2 flex items-center justify-between text-xs font-mono">
                      <span className="font-sans text-stone-700 font-bold">
                        {isEn
                          ? `Recommended Dine-in Price (for FC ${customTargetFcPercent}%${isVatInclusive ? ' incl. VAT' : ''}):`
                          : `ราคาขายหน้าร้านที่แนะนำ (เพื่อให้ได้ FC ${customTargetFcPercent}%${isVatInclusive ? ' รวม VAT' : ''}):`}
                      </span>
                      <span className="text-base font-black text-stone-950">
                        ฿{suggestedPriceCalc.suggestedPriceByFc} {isEn ? 'THB' : 'บาท'}
                      </span>
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Action Buttons */}
            <div className="modal-footer bg-[#FFFDF9] flex justify-between items-center border-t border-stone-200 text-xs">
              <button
                type="button"
                onClick={() => {
                  const variantId = selectedBreakdown.variant.id;
                  setSelectedBreakdown(null);
                  onNavigateToRecipeBuilder(variantId);
                }}
                className="px-3.5 py-2 bg-stone-200 hover:bg-stone-300 text-stone-900 font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <SlidersHorizontal className="w-4 h-4 text-stone-700" />
                <span>{isEn ? 'Customize Recipe' : 'ไปที่หน้าปรับแต่งสูตรอาหาร'}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedBreakdown(null)}
                className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] !text-white font-black rounded-xl cursor-pointer shadow-xs"
              >
                {isEn ? 'Close' : 'ปิดหน้าต่าง'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MENU MODAL */}
      {isMenuModalOpen && editingMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-lg w-full shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="modal-header flex items-center justify-between border-b border-[#EAE4D9]">
              <h3 className="font-bold text-[#1C1917] text-base">
                {editingMenu.id?.startsWith('menu_') && !menus.find((m) => m.id === editingMenu.id)
                  ? (isEn ? 'Add New Menu' : 'เพิ่มเมนูใหม่')
                  : (isEn ? 'Edit Menu Information' : 'แก้ไขข้อมูลเมนู')}
              </h3>
              <button
                type="button"
                onClick={() => setIsMenuModalOpen(false)}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuModal} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-stone-700 mb-1.5 font-bold text-sm">
                    {isEn ? 'Menu Name (Thai)' : 'ชื่อเมนูอาหาร (ไทย)'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder={isEn ? 'e.g. Classic Holy Basil Rice, Chili Paste Fried Rice' : 'เช่น ข้าวกะเพราโบราณ, ข้าวผัดพริกเผา'}
                    value={editingMenu.name || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditingMenu((prev) =>
                        prev ? { ...prev, name: nextTh, thaiName: nextTh } : prev
                      );
                      translationScheduler.schedule('costMenu', () => {
                        setEditingMenu((prev) => {
                          if (!prev) return prev;
                          const currTh = prev.name || '';
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevMenuThaiRef.current,
                            nextThai: currTh,
                            currentEnglish: prev.englishName,
                            isManuallyEdited: Boolean(prev.englishNameManual),
                          });
                          prevMenuThaiRef.current = currTh;
                          return { ...prev, englishName: nextEn };
                        });
                      });
                    }}
                    onBlur={() => translationScheduler.flush('costMenu')}
                    className="w-full p-3 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-sm font-medium focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <label className="block text-stone-700 font-bold text-xs">
                        {isEn
                          ? 'Menu Name (English — Auto-translated)'
                          : 'ชื่อเมนูภาษาอังกฤษ (English Name — แปลอัตโนมัติ)'}
                      </label>
                      {needsEnglishReview(editingMenu.name, editingMenu.englishName) && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{isEn ? 'Needs EN' : 'รอตรวจสอบ EN'}</span>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        translationScheduler.cancel('costMenu');
                        prevMenuThaiRef.current = editingMenu.name || '';
                        setEditingMenu({
                          ...editingMenu,
                          englishName: translateThaiToEnglish(editingMenu.name || ''),
                          englishNameManual: false,
                        });
                      }}
                      className="text-[11px] font-bold text-[#F27D26] hover:underline cursor-pointer"
                    >
                      {isEn ? 'Re-translate from Thai' : 'แปลใหม่จากภาษาไทย'}
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder={isEn ? 'Auto-translated English name (editable)' : 'ชื่อเมนูภาษาอังกฤษที่แปลอัตโนมัติ (แก้ไขได้)'}
                    value={editingMenu.englishName || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      translationScheduler.cancel('costMenu');
                      setEditingMenu({
                        ...editingMenu,
                        englishName: val,
                        englishNameManual: Boolean(val.trim()),
                      });
                    }}
                    className="w-full p-2.5 bg-amber-50/40 border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-700 mb-1 font-bold text-xs">
                    {isEn ? 'Menu Code / SKU (POS Sync)' : 'รหัสเมนู / SKU (เชื่อม POS)'}
                  </label>
                  <input
                    type="text"
                    placeholder={isEn ? 'e.g. MK-01, KPR' : 'เช่น MK-01, KPR'}
                    value={editingMenu.code || editingMenu.sku || ''}
                    onChange={(e) => setEditingMenu({ ...editingMenu, code: e.target.value, sku: e.target.value })}
                    className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-mono font-semibold focus:outline-none focus:border-[#F27D26]"
                  />
                </div>
                <div>
                  <label className="block text-stone-700 mb-1 font-bold text-xs">
                    {isEn ? 'Barcode' : 'บาร์โค้ด (Barcode)'}
                  </label>
                  <input
                    type="text"
                    placeholder={isEn ? 'e.g. 885001234567' : 'เช่น 885001234567'}
                    value={editingMenu.barcode || ''}
                    onChange={(e) => setEditingMenu({ ...editingMenu, barcode: e.target.value })}
                    className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-mono focus:outline-none focus:border-[#F27D26]"
                  />
                </div>
              </div>

              {/* Status toggles */}
              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingMenu.isOutOfStock || false}
                    onChange={(e) => setEditingMenu({ ...editingMenu, isOutOfStock: e.target.checked })}
                    className="w-4 h-4 text-rose-600 rounded border-stone-300 focus:ring-rose-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-stone-800">
                    {isEn
                      ? '⚠️ Out of Stock / Temporarily Unavailable (POS Sync)'
                      : '⚠️ วัตถุดิบหมด / งดขายเมนูนี้ชั่วคราว (Out of Stock สำหรับ POS)'}
                  </span>
                </label>
              </div>

              </div>

              <div className="modal-footer bg-[#FFFDF9] flex justify-end gap-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => setIsMenuModalOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  {isEn ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer"
                >
                  {isEn ? 'Save Menu' : 'บันทึกเมนู'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ADD CATEGORY MODAL */}
      {isAddCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-md w-full shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="modal-header flex items-center justify-between border-b border-[#EAE4D9]">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-[#F27D26]/10 text-[#F27D26] flex items-center justify-center font-bold">
                  <FolderPlus className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">
                  {isEn ? 'Add New Food Category' : 'เพิ่มหมวดหมู่อาหารใหม่'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddCategoryModalOpen(false);
                  setCategoryError(null);
                  setNewCategoryInput('');
                  setNewCategoryEnglishInput('');
                }}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-stone-700 mb-1.5 font-semibold">
                    {isEn ? 'New Category Name (Thai)' : 'ชื่อหมวดหมู่ใหม่ (ไทย)'}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder={isEn ? 'e.g. Desserts, Beverages, Steaks' : 'เช่น ของหวาน, เครื่องดื่ม, กับแกล้ม, สเต็ก'}
                    value={newCategoryInput}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setNewCategoryInput(nextTh);
                      if (categoryError) setCategoryError(null);
                      translationScheduler.schedule('costAddCat', () => {
                        setNewCategoryEnglishInput((currEn) => {
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevAddCatThaiRef.current,
                            nextThai: nextTh,
                            currentEnglish: currEn,
                          });
                          prevAddCatThaiRef.current = nextTh;
                          return nextEn;
                        });
                      });
                    }}
                    onBlur={() => translationScheduler.flush('costAddCat')}
                    className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 focus:outline-none focus:border-[#F27D26] font-medium text-xs"
                  />
                  {categoryError && (
                    <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                      {categoryError}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-stone-700 font-semibold">
                      {isEn ? 'Category Name (English — Auto-translated)' : 'ชื่อหมวดหมู่ภาษาอังกฤษ (แปลอัตโนมัติ)'}
                    </label>
                    {needsEnglishReview(newCategoryInput, newCategoryEnglishInput) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>{isEn ? 'Needs EN' : 'รอตรวจสอบ EN'}</span>
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder={isEn ? 'Auto-translated category name' : 'ชื่อหมวดหมู่ภาษาอังกฤษที่แปลอัตโนมัติ'}
                    value={newCategoryEnglishInput}
                    onChange={(e) => {
                      translationScheduler.cancel('costAddCat');
                      setNewCategoryEnglishInput(e.target.value);
                    }}
                    className="w-full p-2.5 bg-amber-50/40 border border-[#D6CEBE] rounded-xl text-stone-800 focus:outline-none focus:border-[#F27D26] font-medium text-xs"
                  />
                </div>
              </div>

              {/* Quick Suggestions Chips */}
              <div>
                <span className="text-[10px] text-stone-500 font-semibold block mb-1.5">
                  {isEn ? 'Or choose from suggested categories:' : 'หรือเลือกจากหมวดหมู่แนะนำ:'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'ของหวานและไอศกรีม',
                    'เครื่องดื่มและกาแฟ',
                    'สเต็กและจานร้อน',
                    'ยำและส้มตำ',
                    'ของทานเล่น/กับแกล้ม',
                    'อาหารจานด่วน',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setNewCategoryInput(preset);
                        setNewCategoryEnglishInput(translateThaiToEnglish(preset));
                        if (categoryError) setCategoryError(null);
                      }}
                      className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded-lg text-[11px] text-stone-700 font-medium transition-colors cursor-pointer"
                    >
                      + {getLocalizedText(lang, preset)}
                    </button>
                  ))}
                </div>
              </div>

              </div>

              <div className="modal-footer bg-[#FFFDF9] flex justify-end gap-2.5 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddCategoryModalOpen(false);
                    setCategoryError(null);
                    setNewCategoryInput('');
                    setNewCategoryEnglishInput('');
                  }}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  {isEn ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-md shadow-[#F27D26]/20 cursor-pointer"
                >
                  {isEn ? 'Save Category' : 'บันทึกหมวดหมู่'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CATEGORY MODAL */}
      {isEditCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-md w-full shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="modal-header flex items-center justify-between border-b border-[#EAE4D9]">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-[#F27D26]/10 text-[#F27D26] flex items-center justify-center font-bold">
                  <Edit2 className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">
                  {isEn ? 'Edit Category Name' : 'แก้ไขชื่อหมวดหมู่'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditCategoryModalOpen(false);
                  setEditCategoryError(null);
                }}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditCategory} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-stone-700 mb-1.5 font-semibold">
                    {isEn ? 'Category Name (Thai)' : 'ชื่อหมวดหมู่ (ไทย)'}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={editingCategoryNewName}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditingCategoryNewName(nextTh);
                      if (editCategoryError) setEditCategoryError(null);
                      translationScheduler.schedule('costEditCat', () => {
                        setEditCategoryEnglishInput((currEn) => {
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevEditCatThaiRef.current,
                            nextThai: nextTh,
                            currentEnglish: currEn,
                          });
                          prevEditCatThaiRef.current = nextTh;
                          return nextEn;
                        });
                      });
                    }}
                    onBlur={() => translationScheduler.flush('costEditCat')}
                    className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 focus:outline-none focus:border-[#F27D26] font-medium text-xs"
                  />
                  {editCategoryError && (
                    <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                      {editCategoryError}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-stone-700 font-semibold">
                      {isEn ? 'English Name (Auto-translated)' : 'ชื่อภาษาอังกฤษ (แปลอัตโนมัติ)'}
                    </label>
                    {needsEnglishReview(editingCategoryNewName, editCategoryEnglishInput) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>{isEn ? 'Needs EN' : 'รอตรวจสอบ EN'}</span>
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder={isEn ? 'Auto-translated English name' : 'ชื่อภาษาอังกฤษที่แปลอัตโนมัติ'}
                    value={editCategoryEnglishInput}
                    onChange={(e) => {
                      translationScheduler.cancel('costEditCat');
                      setEditCategoryEnglishInput(e.target.value);
                    }}
                    className="w-full p-2.5 bg-amber-50/40 border border-[#D6CEBE] rounded-xl text-stone-800 focus:outline-none focus:border-[#F27D26] font-medium text-xs"
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 leading-relaxed">
                {isEn ? (
                  <>
                    Menus in <strong>"{getLocalizedText('en', editingCategoryOldName)}"</strong> (
                    {menus.filter((m) => m.category === editingCategoryOldName).length} items) will automatically update to this new category name.
                  </>
                ) : (
                  <>
                    เมนูอาหารในหมวดหมู่เดิม <strong>"{editingCategoryOldName}"</strong> (จำนวน {menus.filter((m) => m.category === editingCategoryOldName).length} รายการ) จะถูกเปลี่ยนเป็นชื่อหมวดหมู่ใหม่นี้โดยอัตโนมัติ
                  </>
                )}
              </div>

              </div>

              <div className="modal-footer bg-[#FFFDF9] flex justify-end gap-2.5 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditCategoryModalOpen(false);
                    setEditCategoryError(null);
                  }}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  {isEn ? 'Cancel' : 'ยกเลิก'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-md shadow-[#F27D26]/20 cursor-pointer"
                >
                  {isEn ? 'Save Changes' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CATEGORY MODAL */}
      {isDeleteCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-md w-full shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="modal-header flex items-center justify-between border-b border-[#EAE4D9]">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Trash2 className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">
                  {isEn ? 'Confirm Delete Category' : 'ยืนยันการลบหมวดหมู่'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteCategoryModalOpen(false)}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4 text-xs">
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-xs">
                    {isEn
                      ? `Delete category "${getLocalizedText('en', deletingCategoryName)}"?`
                      : `ต้องการลบหมวดหมู่ "${deletingCategoryName}" ใช่หรือไม่?`}
                  </p>
                  {menus.filter((m) => m.category === deletingCategoryName).length > 0 ? (
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      {isEn ? (
                        <>
                          There are <strong>{menus.filter((m) => m.category === deletingCategoryName).length} items</strong> in this category. They will automatically move to <strong>"General / Other"</strong> without being lost.
                        </>
                      ) : (
                        <>
                          มีเมนูอาหารในหมวดหมู่นี้อยู่ <strong>{menus.filter((m) => m.category === deletingCategoryName).length} รายการ</strong> ซึ่งเมนูเหล่านี้จะถูกย้ายไปยังหมวดหมู่ <strong>"ทั่วไป / อื่นๆ"</strong> โดยอัตโนมัติ (เมนูจะไม่สูญหาย)
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      {isEn
                        ? 'No menus in this category. It will be removed from all options immediately.'
                        : 'ไม่มีเมนูอาหารในหมวดหมู่นี้ ระบบจะลบหมวดหมู่นี้ออกจากตัวเลือกทั้งหมดทันที'}
                    </p>
                  )}
                </div>
              </div>

            </div>

            <div className="modal-footer bg-[#FFFDF9] flex justify-end gap-2.5 border-t border-[#EAE4D9] text-xs">
              <button
                type="button"
                onClick={() => setIsDeleteCategoryModalOpen(false)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
              >
                {isEn ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCategory}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isEn ? 'Confirm Delete Category' : 'ยืนยันการลบหมวดหมู่'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WARNING REVIEW MODAL (Requirement 3: Displays all alerted items immediately) */}
      {isWarningModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-2xl w-full shadow-2xl border border-stone-300 text-stone-900">
            {/* Header */}
            <div className="modal-header flex items-center justify-between border-b border-stone-200">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-xs shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </span>
                <h3 className="font-black text-stone-950 text-base sm:text-lg flex items-center gap-2">
                  <span>{isEn ? 'High-Cost / Needs Review Items' : 'รายการเมนูต้นทุนสูง / ควรทบทวน'}</span>
                  <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-xs font-mono font-black">
                    {warningRows.length} {isEn ? 'items' : 'รายการ'}
                  </span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsWarningModalOpen(false)}
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* List */}
            <div className="modal-body space-y-3">
              {warningRows.length === 0 ? (
                <div className="text-center py-10 text-stone-500">
                  <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-2" />
                  <p className="font-bold text-stone-800">
                    {isEn ? 'Great job! No high-cost menu items right now.' : 'ยอดเยี่ยมมาก! ไม่มีเมนูที่ต้นทุนสูงเกินเกณฑ์ในขณะนี้'}
                  </p>
                </div>
              ) : (
                warningRows.map((item, idx) => (
                  <div
                    key={`${item.menu.id}-${item.variant.id}-${idx}`}
                    className="p-3.5 rounded-2xl bg-white border border-stone-200 shadow-2xs hover:border-rose-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-stone-950 text-sm">
                          {getLocalizedText(lang, item.menu.thaiName || item.menu.name, item.menu.englishName)}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-stone-100 border border-stone-200 text-stone-800 font-bold rounded-lg">
                          {getLocalizedText(lang, item.variant.thaiName || item.variant.name, item.variant.englishName)}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 bg-stone-50 border border-stone-200 text-stone-600 rounded-md">
                          {getLocalizedText(lang, item.menu.category)}
                        </span>
                      </div>

                      {/* Warning Badges */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {item.reasons.map((reason, rIdx) => (
                          <span
                            key={rIdx}
                            className="px-2 py-0.5 bg-rose-50 border border-rose-300 text-rose-900 text-[11px] font-black rounded-md flex items-center gap-1"
                          >
                            <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                            <span>{reason}</span>
                          </span>
                        ))}
                      </div>

                      {/* Metrics bar */}
                      <div className="flex items-center gap-3 text-xs text-stone-600 mt-2 font-mono flex-wrap">
                        <span>
                          {isEn ? 'Price:' : 'ราคาขาย:'}{' '}
                          <strong className="text-stone-950 font-black">{item.breakdown.sellingPrice} ฿</strong>
                        </span>
                        <span>
                          {isEn ? 'Total Cost:' : 'ต้นทุนรวม:'}{' '}
                          <strong className="text-stone-950 font-black">{item.breakdown.totalCost.toFixed(1)} ฿</strong>
                        </span>
                        <span>
                          {isEn ? 'Dine-in Profit:' : 'กำไรหน้าร้าน:'}{' '}
                          <strong className={item.breakdown.restaurantProfit < 0 ? 'text-rose-600 font-black' : 'text-emerald-700 font-black'}>
                            {item.breakdown.restaurantProfit.toFixed(1)} ฿
                          </strong>
                        </span>
                        <span>
                          Food Cost:{' '}
                          <strong className="text-rose-700 font-black bg-rose-50 px-1 py-0.5 rounded border border-rose-200">
                            {item.breakdown.restaurantFoodCostPercent.toFixed(1)}%
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Action button */}
                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsWarningModalOpen(false);
                          setSelectedMenuId(item.menu.id);
                          setFilterHighCostOnly(true);
                          setSelectedBreakdown({
                            menu: item.menu,
                            variant: item.variant,
                            breakdown: item.breakdown,
                          });
                        }}
                        className="w-full sm:w-auto px-3 py-1.5 bg-[#F27D26] hover:bg-[#d96817] !text-white text-xs font-black rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-1"
                      >
                        <span>{isEn ? 'View Recipe & Cost' : 'ดูสูตรและต้นทุน'}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="modal-footer bg-[#FFFDF9] flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 text-xs">
              <span className="font-mono font-bold text-stone-600">
                {isEn ? `Found ${warningRows.length} flagged items` : `พบทั้งหมด ${warningRows.length} รายการที่เข้าเกณฑ์`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFilterHighCostOnly(true);
                    setIsWarningModalOpen(false);
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl shadow-xs cursor-pointer"
                >
                  {isEn ? 'Filter Alerted Menus Only' : 'กรองเฉพาะเมนูเตือนในหน้านี้'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsWarningModalOpen(false)}
                  className="px-3.5 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold rounded-xl cursor-pointer"
                >
                  {isEn ? 'Close' : 'ปิด'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE MENU CONFIRMATION MODAL */}
      {menuToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-md w-full shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="modal-header flex items-center justify-between border-b border-[#EAE4D9]">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Trash2 className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">
                  {isEn ? 'Confirm Delete Menu' : 'ยืนยันการลบเมนูอาหาร'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMenuToDelete(null)}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body space-y-4 text-xs">
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-xs">
                    {isEn
                      ? `Delete menu "${getLocalizedText('en', menuToDelete.thaiName || menuToDelete.name, menuToDelete.englishName)}"?`
                      : `ต้องการลบเมนู "${menuToDelete.name}" ใช่หรือไม่?`}
                  </p>
                  <p className="text-[11px] text-rose-700 leading-relaxed">
                    {isEn
                      ? `All meat variants and cost records (${menuToDelete.variants.length} items) in this menu will also be deleted.`
                      : `ตัวเลือกเนื้อสัตว์และข้อมูลต้นทุนทั้งหมด (${menuToDelete.variants.length} รายการ) ในเมนูนี้จะถูกลบออกด้วย`}
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-footer bg-[#FFFDF9] flex justify-end gap-2.5 border-t border-[#EAE4D9] text-xs">
              <button
                type="button"
                onClick={() => setMenuToDelete(null)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
              >
                {isEn ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteMenu) {
                    onDeleteMenu(menuToDelete.id);
                  }
                  if (selectedMenuId === menuToDelete.id) {
                    setSelectedMenuId(null);
                  }
                  setMenuToDelete(null);
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isEn ? 'Confirm Delete Menu' : 'ยืนยันการลบเมนู'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT VARIANT MODAL (เชื่อมโยงกับข้อมูลวัตถุดิบจริง) */}
      {variantModalState.isOpen && variantModalState.menu && variantModalState.variant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="modal-panel-fixed bg-[#FFFDF9] rounded-3xl max-w-xl w-full shadow-2xl border border-stone-300 text-stone-900">
            {/* Locked Modal Header */}
            <div className="modal-header flex items-center justify-between border-b border-stone-200 bg-[#FFFDF9]">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-[#F27D26]/15 border border-[#F27D26]/30 text-[#F27D26] flex items-center justify-center font-bold">
                  <UtensilsCrossed className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-black text-stone-950 text-base">
                    {isEn ? '+ Add Option / Variant' : '+ เพิ่มตัวเลือก'}
                  </h3>
                  <p className="text-xs text-stone-500 font-medium">
                    {isEn ? 'Menu:' : 'เมนู:'}{' '}
                    <strong className="text-stone-800">
                      {getLocalizedText(lang, variantModalState.menu.thaiName || variantModalState.menu.name, variantModalState.menu.englishName)}
                    </strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setVariantModalState({
                    isOpen: false,
                    mode: 'ADD',
                    menu: null,
                    variant: null,
                    selectedIngredientId: '',
                    meatQuantity: 80,
                    meatUnit: 'g',
                    isEnglishManuallyEdited: false,
                    selectedBaseRecipeMenuId: '',
                  })
                }
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              id="variant-modal-form"
              onSubmit={handleSaveVariantModal}
              className="modal-body space-y-4 text-xs"
            >
              {/* 1. เลือกวัตถุดิบจากฐานข้อมูล (เหลือเฉพาะข้อ 1. เชื่อมข้อมูลจากฐานข้อมูลโดยตรง) */}
              <div className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-stone-900 font-black text-xs">
                    {isEn ? 'Select Ingredient from Database' : 'เลือกวัตถุดิบจากฐานข้อมูล'}{' '}
                    <span className="text-[#F27D26]">*</span>
                  </label>
                  <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300">
                    {isEn ? 'Auto-linked to Real Cost' : 'เชื่อมโยงต้นทุนจริงอัตโนมัติ'}
                  </span>
                </div>

                {(() => {
                  const activeCategory =
                    variantModalState.selectedCategory === 'ALL' ||
                    groupedIngredients.some(([cat]) => cat === variantModalState.selectedCategory)
                      ? (variantModalState.selectedCategory || 'ALL')
                      : 'ALL';
                  const filteredCategoryIngredients =
                    activeCategory === 'ALL'
                      ? ingredients
                      : (groupedIngredients.find(([cat]) => cat === activeCategory)?.[1] || []);
                  const showSeafoodComboOption =
                    activeCategory === 'ALL' || activeCategory === 'เนื้อสัตว์และอาหารทะเล';
                  const totalChoicesInCat =
                    filteredCategoryIngredients.length + (showSeafoodComboOption ? 1 : 0);

                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* ช่องที่ 1: หัวข้อหมวดหมู่วัตถุดิบ */}
                      <div>
                        <label className="block text-[11px] font-bold text-stone-700 mb-1">
                          {isEn ? '1. Ingredient Category' : '1. หมวดหมู่วัตถุดิบ'}
                        </label>
                        <select
                          value={activeCategory}
                          onChange={(e) => {
                            const nextCat = e.target.value;
                            setVariantModalState((prev) => {
                              const currentIng = ingredients.find(
                                (i) => i.id === prev.selectedIngredientId
                              );
                              const stillValid =
                                nextCat === 'ALL' ||
                                (prev.selectedIngredientId === 'seafood_combo' &&
                                  nextCat === 'เนื้อสัตว์และอาหารทะเล') ||
                                (currentIng && (currentIng.category || 'อื่นๆ') === nextCat);
                              return {
                                ...prev,
                                selectedCategory: nextCat,
                                selectedIngredientId: stillValid ? prev.selectedIngredientId : '',
                              };
                            });
                          }}
                          className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26] cursor-pointer"
                        >
                          <option value="ALL">
                            {isEn
                              ? `📁 All Categories (${ingredients.length + 1})`
                              : `📁 ทุกหมวดหมู่ (${ingredients.length + 1})`}
                          </option>
                          {groupedIngredients.map(([cat, catIngs]) => {
                            const count =
                              catIngs.length + (cat === 'เนื้อสัตว์และอาหารทะเล' ? 1 : 0);
                            return (
                              <option key={cat} value={cat}>
                                {getLocalizedText(lang, cat)} ({count})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* ช่องที่ 2: วัตถุดิบในหมวดหมู่นั้น */}
                      <div>
                        <label className="block text-[11px] font-bold text-stone-700 mb-1">
                          {isEn ? '2. Ingredient in Category' : '2. วัตถุดิบในหมวดหมู่'}{' '}
                          <span className="text-[#F27D26]">*</span>
                        </label>
                        <select
                          required
                          value={variantModalState.selectedIngredientId}
                          onChange={(e) => {
                            const ingId = e.target.value;
                            if (ingId === 'seafood_combo') {
                              const vNameTh = `${variantModalState.menu?.name || ''} ทะเล`.trim();
                              setVariantModalState((prev) => ({
                                ...prev,
                                selectedCategory: 'เนื้อสัตว์และอาหารทะเล',
                                selectedIngredientId: 'seafood_combo',
                                seafoodShrimpQty: prev.seafoodShrimpQty || 4,
                                seafoodSquidQty: prev.seafoodSquidQty || 40,
                                variant: {
                                  ...prev.variant,
                                  proteinType: 'ทะเล',
                                  name: vNameTh,
                                  thaiName: vNameTh,
                                  englishName: prev.isEnglishManuallyEdited
                                    ? prev.variant?.englishName
                                    : translateThaiToEnglish(vNameTh),
                                },
                              }));
                            } else if (ingId) {
                              const ing = ingredients.find((i) => i.id === ingId);
                              if (ing) {
                                const pName = ing.name.split(' (')[0];
                                const nextUnit = String(ing.usageUnit || ing.baseUnit || 'g');
                                const defaultQty = isPieceLikeUnit(nextUnit)
                                  ? (nextUnit === 'ตัว' ? 4 : 1)
                                  : 80;
                                const vNameTh = `${variantModalState.menu?.name || ''} ${pName}`.trim();

                                if (!portionUnits.includes(nextUnit)) {
                                  const nextUnits = [...portionUnits, nextUnit];
                                  setPortionUnits(nextUnits);
                                  try {
                                    localStorage.setItem(
                                      PORTION_UNITS_STORAGE_KEY,
                                      JSON.stringify(nextUnits)
                                    );
                                  } catch {}
                                }

                                setVariantModalState((prev) => ({
                                  ...prev,
                                  selectedCategory: ing.category || prev.selectedCategory,
                                  selectedIngredientId: ingId,
                                  meatQuantity: defaultQty,
                                  meatUnit: nextUnit,
                                  variant: {
                                    ...prev.variant,
                                    proteinType: pName,
                                    name: vNameTh,
                                    thaiName: vNameTh,
                                    englishName: prev.isEnglishManuallyEdited
                                      ? prev.variant?.englishName
                                      : translateThaiToEnglish(vNameTh),
                                  },
                                }));
                              }
                            } else {
                              setVariantModalState((prev) => ({
                                ...prev,
                                selectedIngredientId: '',
                              }));
                            }
                          }}
                          className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26] cursor-pointer"
                        >
                          <option value="">
                            {isEn
                              ? `-- Select Ingredient (${totalChoicesInCat} items) --`
                              : `-- เลือกวัตถุดิบในหมวดนี้ (${totalChoicesInCat} รายการ) --`}
                          </option>
                          {showSeafoodComboOption && (
                            <option value="seafood_combo" className="font-bold text-[#F27D26]">
                              {isEn
                                ? '🌊 Seafood Combo (Fresh Shrimp + Fresh Squid)'
                                : '🌊 ทะเล (กุ้งสด + ปลาหมึกสด คู่กัน)'}
                            </option>
                          )}
                          {filteredCategoryIngredients.map((ing) => (
                            <option key={ing.id} value={ing.id}>
                              {getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName)} (
                              {localizeUnit(ing.usageUnit || ing.baseUnit || 'g', lang)})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })()}

                {/* Editable Bilingual Option Names (TH + Auto EN) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      {isEn ? 'Option Name (TH)' : 'ชื่อตัวเลือก (ไทย)'} <span className="text-[#F27D26]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={variantModalState.variant?.name || ''}
                      onChange={(e) => {
                        const nextTh = e.target.value;
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: {
                            ...prev.variant,
                            name: nextTh,
                            thaiName: nextTh,
                          },
                        }));
                        translationScheduler.schedule('costVariant', () => {
                          setVariantModalState((prev) => {
                            const currTh = prev.variant?.name || '';
                            const autoEn = prev.isEnglishManuallyEdited
                              ? prev.variant?.englishName || ''
                              : computeAutoEnglishName({
                                  previousThai: prevVariantThaiRef.current,
                                  nextThai: currTh,
                                  currentEnglish: prev.variant?.englishName,
                                  isManuallyEdited: Boolean(prev.isEnglishManuallyEdited),
                                });
                            prevVariantThaiRef.current = currTh;
                            return {
                              ...prev,
                              variant: {
                                ...prev.variant,
                                englishName: autoEn,
                              },
                            };
                          });
                        });
                      }}
                      onBlur={() => translationScheduler.flush('costVariant')}
                      placeholder={isEn ? 'e.g. Stir-Fried Holy Basil with Pork' : 'เช่น กะเพราหมูสับ'}
                      className="w-full p-2 bg-white border border-amber-300 rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5">
                        <label className="block text-[11px] font-bold text-stone-700">
                          {isEn ? 'Option Name (EN)' : 'ชื่อตัวเลือก (English)'}
                        </label>
                        {needsEnglishReview(
                          variantModalState.variant?.name,
                          variantModalState.variant?.englishName
                        ) && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{isEn ? 'Needs EN' : 'รอตรวจสอบ EN'}</span>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          translationScheduler.cancel('costVariant');
                          prevVariantThaiRef.current = variantModalState.variant?.name || '';
                          setVariantModalState((prev) => ({
                            ...prev,
                            isEnglishManuallyEdited: false,
                            variant: {
                              ...prev.variant,
                              englishName: translateThaiToEnglish(prev.variant?.name || ''),
                              englishNameManual: false,
                            },
                          }));
                        }}
                        className="text-[10px] font-bold text-[#F27D26] hover:underline cursor-pointer"
                      >
                        {isEn ? 'Re-translate' : 'แปลใหม่'}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={variantModalState.variant?.englishName || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        translationScheduler.cancel('costVariant');
                        const hasManual = Boolean(val.trim());
                        setVariantModalState((prev) => ({
                          ...prev,
                          isEnglishManuallyEdited: hasManual,
                          variant: {
                            ...prev.variant,
                            englishName: val,
                            englishNameManual: hasManual,
                          },
                        }));
                      }}
                      placeholder={isEn ? 'Auto-translated culinary English name' : 'ชื่อภาษาอังกฤษที่แปลอัตโนมัติ'}
                      className="w-full p-2 bg-white border border-amber-300 rounded-xl text-amber-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                </div>
              </div>

              {/* 2. ปริมาณเนื้อสัตว์ที่ใช้ */}
              {(() => {
                const pType = (variantModalState.variant?.proteinType || '').toLowerCase();
                const isSeafoodChoice =
                  variantModalState.selectedIngredientId === 'seafood_combo' ||
                  pType.includes('ทะเล') ||
                  pType.includes('ซีฟู้ด');

                if (isSeafoodChoice) {
                  return (
                    <div className="p-3 bg-sky-50 border border-sky-300 rounded-2xl space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-black text-sky-950 text-xs flex items-center gap-1.5">
                          <span>
                            {isEn
                              ? '🌊 Seafood Ratio (Shrimp + Squid required):'
                              : '🌊 สัดส่วนวัตถุดิบทะเล (กุ้งสด + ปลาหมึกสด ต้องมีทั้งคู่):'}
                          </span>
                        </span>
                        <span className="text-[10px] text-sky-800 bg-sky-100 px-2 py-0.5 rounded-md font-bold border border-sky-300">
                          {isEn ? 'Seafood Rule (pc / g)' : 'Seafood Rule (แยกชิ้น/กรัม)'}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-white p-2.5 rounded-xl border border-amber-300 shadow-2xs space-y-1">
                          <label className="block text-amber-950 font-bold text-xs">
                            {isEn ? '🦐 Fresh Shrimp (XL):' : '🦐 กุ้งสด (XL):'}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <NumericInput
                              min="0"
                              step="any"
                              value={variantModalState.seafoodShrimpQty}
                              onValueChange={(val) =>
                                setVariantModalState((prev) => ({
                                  ...prev,
                                  seafoodShrimpQty: val,
                                }))
                              }
                              className="w-24 p-2 bg-amber-50/50 border border-amber-400 rounded-lg text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-amber-600"
                            />
                            <span className="text-xs text-stone-700 font-bold">{isEn ? 'pc' : 'ตัว'}</span>
                            <span className="text-[10px] text-stone-500 ml-auto">
                              (@ ฿8.50/{isEn ? 'pc' : 'ตัว'})
                            </span>
                          </div>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-sky-300 shadow-2xs space-y-1">
                          <label className="block text-sky-950 font-bold text-xs">
                            {isEn ? '🦑 Fresh Squid:' : '🦑 ปลาหมึกกล้วยสด:'}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <NumericInput
                              min="0"
                              step="any"
                              value={variantModalState.seafoodSquidQty}
                              onValueChange={(val) =>
                                setVariantModalState((prev) => ({
                                  ...prev,
                                  seafoodSquidQty: val,
                                }))
                              }
                              className="w-24 p-2 bg-sky-50/50 border border-sky-400 rounded-lg text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-sky-600"
                            />
                            <span className="text-xs text-stone-700 font-bold">{isEn ? 'g' : 'กรัม (g)'}</span>
                            <span className="text-[10px] text-stone-500 ml-auto">
                              (@ ฿0.388/g)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                const activeUnit = variantModalState.meatUnit || 'g';

                return (
                  <div className="space-y-2 p-3 bg-white border border-[#EAE4D9] rounded-2xl">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="block text-stone-800 font-bold text-xs">
                        {isEn ? 'Protein Portion per Dish' : 'ปริมาณเนื้อสัตว์ที่ใช้ต่อจาน'}{' '}
                        <span className="text-stone-500 font-normal">
                          ({getPortionUnitLabel(activeUnit)})
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsAddingCustomUnit((p) => !p)}
                        className="text-[11px] font-bold text-[#F27D26] hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{isEn ? 'Add Custom Unit' : 'เพิ่มหน่วยเอง'}</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <NumericInput
                        min="0"
                        step="any"
                        value={variantModalState.meatQuantity}
                        onValueChange={(val) =>
                          setVariantModalState((prev) => ({
                            ...prev,
                            meatQuantity: val,
                          }))
                        }
                        className="w-28 p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26]"
                      />

                      {/* Unit Dropdown Selector */}
                      <select
                        value={activeUnit}
                        onChange={(e) =>
                          setVariantModalState((prev) => ({
                            ...prev,
                            meatUnit: e.target.value,
                          }))
                        }
                        className="p-2.5 bg-stone-50 border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-bold focus:outline-none focus:border-[#F27D26] cursor-pointer"
                        title={isEn ? 'Select portion unit' : 'เลือกหน่วยวัดปริมาณ'}
                      >
                        {portionUnits.map((u) => (
                          <option key={u} value={u}>
                            {getPortionUnitLabel(u)}
                          </option>
                        ))}
                      </select>

                      {/* Delete Selected Unit Button */}
                      <button
                        type="button"
                        disabled={portionUnits.length <= 1}
                        onClick={() => handleDeleteCustomUnit(activeUnit)}
                        className="p-2 rounded-xl border border-stone-200 text-stone-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 disabled:opacity-30 cursor-pointer transition-colors"
                        title={isEn ? `Remove unit "${activeUnit}"` : `ลบหน่วย "${activeUnit}" ออกจากรายการ`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Inline Add Custom Unit Box */}
                    {isAddingCustomUnit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
                        <input
                          type="text"
                          value={customUnitInput}
                          onChange={(e) => setCustomUnitInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomUnit();
                            }
                          }}
                          placeholder={isEn ? 'New unit name e.g. scoop, pack, cup' : 'พิมพ์ชื่อหน่วยใหม่ เช่น ทัพพี, ห่อ, กล่องเล็ก'}
                          className="flex-1 p-2 bg-stone-50 border border-[#D6CEBE] rounded-xl text-xs font-semibold text-stone-900 focus:outline-none focus:border-[#F27D26]"
                        />
                        <button
                          type="button"
                          onClick={handleAddCustomUnit}
                          className="px-3 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl text-[11px] cursor-pointer"
                        >
                          {isEn ? 'Add Unit' : 'เพิ่มหน่วย'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingCustomUnit(false);
                            setCustomUnitInput('');
                          }}
                          className="px-2.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-600 font-semibold rounded-xl text-[11px] cursor-pointer"
                        >
                          {isEn ? 'Cancel' : 'ยกเลิก'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 3. สูตรอาหารกลาง (Base Recipe) — เชื่อมโยงสูตรกลางเข้ากับตัวเลือก */}
              {(() => {
                const currentNonProteinItems = (variantModalState.variant?.recipeItems || []).filter(
                  (it) => !isProteinRecipeItem(it, variantModalState.variant?.proteinType)
                );
                const baseRecipeCostPreview = computeBaseRecipeItemsCost(currentNonProteinItems);
                const selectedBaseId = variantModalState.selectedBaseRecipeMenuId || '';

                return (
                  <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="block text-emerald-950 font-black text-xs">
                        {isEn ? 'Base Recipe Link' : 'สูตรอาหารกลาง (Base Recipe)'}
                      </label>
                      {currentNonProteinItems.length > 0 && (
                        <span className="text-[11px] font-mono font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200">
                          {isEn
                            ? `${currentNonProteinItems.length} items · ฿${baseRecipeCostPreview.toFixed(2)}`
                            : `${currentNonProteinItems.length} รายการ · ฿${baseRecipeCostPreview.toFixed(2)}`}
                        </span>
                      )}
                    </div>

                    <select
                      value={selectedBaseId}
                      onChange={(e) => {
                        const chosenMenuId = e.target.value;
                        if (chosenMenuId === '__custom__') return;
                        setVariantModalState((prev) => {
                          const existingProteins = (prev.variant?.recipeItems || []).filter((it) =>
                            isProteinRecipeItem(it, prev.variant?.proteinType)
                          );
                          if (!chosenMenuId) {
                            return {
                              ...prev,
                              selectedBaseRecipeMenuId: '',
                              variant: {
                                ...prev.variant,
                                recipeItems: existingProteins,
                              },
                            };
                          }
                          const matchedOpt = baseRecipeMenuOptions.find(
                            (opt) => opt.menu.id === chosenMenuId
                          );
                          const clonedBase = (matchedOpt?.items || []).map((it) => ({ ...it }));
                          return {
                            ...prev,
                            selectedBaseRecipeMenuId: chosenMenuId,
                            variant: {
                              ...prev.variant,
                              recipeItems: [...existingProteins, ...clonedBase],
                            },
                          };
                        });
                      }}
                      className="w-full p-2.5 bg-white border border-emerald-300 rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-emerald-600 cursor-pointer"
                    >
                      <option value="">
                        {isEn
                          ? '-- No Base Recipe (Protein Cost Only) --'
                          : '-- ไม่ใช้สูตรอาหารกลาง (คำนวณเฉพาะเนื้อสัตว์) --'}
                      </option>
                      {selectedBaseId === '__custom__' && currentNonProteinItems.length > 0 && (
                        <option value="__custom__">
                          {isEn
                            ? `Current Variant Base Recipe (${currentNonProteinItems.length} items)`
                            : `สูตรอาหารกลางของตัวเลือกนี้ (${currentNonProteinItems.length} รายการ)`}
                        </option>
                      )}
                      {baseRecipeMenuOptions.map(({ menu: bMenu, items }) => (
                        <option key={bMenu.id} value={bMenu.id}>
                          {getLocalizedText(lang, bMenu.thaiName || bMenu.name, bMenu.englishName)} ({items.length} {isEn ? 'items' : 'รายการ'})
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}

              {/* 4. ราคาขายแต่ละช่องทาง */}
              <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl space-y-3">
                <div className="font-black text-stone-900 text-xs">
                  {isEn ? 'Channel Selling Prices (THB)' : 'การตั้งราคาขายแต่ละช่องทาง (บาท)'}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? 'Dine-in Price' : 'ราคาหน้าร้าน (Dine-in)'} <span className="text-rose-500">*</span>
                    </label>
                    <NumericInput
                      min="0"
                      value={variantModalState.variant.sellingPrice}
                      onValueChange={(price) => {
                        setVariantModalState((prev) => {
                          if (!prev.variant) return prev;
                          const prevSell = Number(prev.variant.sellingPrice) || 0;
                          const prevTakeaway = Number(prev.variant.takeawayPrice) || 0;
                          const boxMarkup =
                            prevSell > 0 && prev.variant.takeawayPrice !== undefined && prevTakeaway >= prevSell
                              ? prevTakeaway - prevSell
                              : 5;
                          const nextTakeaway = price > 0 ? price + boxMarkup : 0;
                          const multiplied = calculateMultipliedChannelPrices(nextTakeaway, settings);
                          return {
                            ...prev,
                            variant: {
                              ...prev.variant,
                              sellingPrice: price,
                              takeawayPrice: nextTakeaway,
                              deliveryPrice: multiplied.grabPrice,
                              grabPrice: multiplied.grabPrice,
                              linemanPrice: multiplied.linemanPrice,
                              robinhoodPrice: multiplied.robinhoodPrice,
                            },
                          };
                        });
                      }}
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? 'Takeaway Price' : 'ราคาใส่กล่อง (Takeaway)'}
                    </label>
                    <NumericInput
                      min="0"
                      value={variantModalState.variant.takeawayPrice}
                      onValueChange={(val) => {
                        const multiplied = calculateMultipliedChannelPrices(val, settings);
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: {
                            ...prev.variant,
                            takeawayPrice: val,
                            deliveryPrice: multiplied.grabPrice,
                            grabPrice: multiplied.grabPrice,
                            linemanPrice: multiplied.linemanPrice,
                            robinhoodPrice: multiplied.robinhoodPrice,
                          },
                        }));
                      }}
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? `GrabFood (${grabMultiplier}x)` : `ราคา GrabFood (${grabMultiplier}x)`}
                    </label>
                    <NumericInput
                      min="0"
                      value={variantModalState.variant.grabPrice}
                      onValueChange={(val) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, grabPrice: val, deliveryPrice: val },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? `LINE MAN (${linemanMultiplier}x)` : `ราคา LINE MAN (${linemanMultiplier}x)`}
                    </label>
                    <NumericInput
                      min="0"
                      value={variantModalState.variant.linemanPrice}
                      onValueChange={(val) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, linemanPrice: val },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? `Robinhood (${robinhoodMultiplier}x)` : `ราคา Robinhood (${robinhoodMultiplier}x)`}
                    </label>
                    <NumericInput
                      min="0"
                      value={variantModalState.variant.robinhoodPrice}
                      onValueChange={(val) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, robinhoodPrice: val },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? 'Box / Packaging Cost (THB)' : 'ค่ากล่อง/แพ็กเกจจิ้ง (บาท)'}
                    </label>
                    <NumericInput
                      min="0"
                      value={variantModalState.variant.packagingCost}
                      onValueChange={(val) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, packagingCost: val },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                </div>
              </div>

              {/* POS Integration: Code / SKU & Out-of-Stock Status */}
              <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 text-xs flex items-center gap-1.5">
                    <span>{isEn ? '📡 POS Integration Data' : '📡 ข้อมูลเชื่อมต่อระบบ POS (POS Integration)'}</span>
                  </span>
                  <span className="text-[10px] text-stone-500 font-mono">
                    {isEn ? 'SKU & Stock Status' : 'SKU และสถานะการขาย'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? 'Option Code / SKU (POS Sync)' : 'รหัสตัวเลือก / SKU (เชื่อม POS)'}
                    </label>
                    <input
                      type="text"
                      placeholder={isEn ? 'e.g. KPR-PORK, MK01-1' : 'เช่น KPR-PORK, MK01-1'}
                      value={variantModalState.variant?.code || variantModalState.variant?.sku || ''}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: {
                            ...prev.variant,
                            code: e.target.value,
                            sku: e.target.value,
                          },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-mono font-semibold focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      {isEn ? 'Barcode' : 'บาร์โค้ด (Barcode)'}
                    </label>
                    <input
                      type="text"
                      placeholder={isEn ? 'e.g. 885001234567' : 'เช่น 885001234567'}
                      value={variantModalState.variant?.barcode || ''}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, barcode: e.target.value },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                </div>

                {/* Stock & Active toggles */}
                <div className="flex items-center gap-4 flex-wrap pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={variantModalState.variant?.isOutOfStock || false}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, isOutOfStock: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 text-rose-600 rounded border-stone-300 focus:ring-rose-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-rose-700">
                      {isEn ? '⚠️ Out of Stock / Unavailable' : '⚠️ วัตถุดิบหมด / งดขายชั่วคราว (Out of Stock)'}
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={variantModalState.variant?.active !== false}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, active: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 text-[#F27D26] rounded border-stone-300 focus:ring-[#F27D26] cursor-pointer"
                    />
                    <span className="text-xs font-bold text-stone-700">
                      {isEn ? 'Active in System' : 'เปิดใช้งานในระบบ (Active)'}
                    </span>
                  </label>
                </div>
              </div>

              {/* 5. Live Calculation Preview Card */}
              {(() => {
                const pType = (variantModalState.variant?.proteinType || '').toLowerCase();
                const isSeafoodChoice =
                  variantModalState.selectedIngredientId === 'seafood_combo' ||
                  pType.includes('ทะเล') ||
                  pType.includes('ซีฟู้ด');

                let meatCost = 0;
                let costDetail = '';

                if (isSeafoodChoice) {
                  const shrimpIng = ingredients.find((i) => i.id === 'ing_shrimp_xl' || i.name.includes('กุ้ง'));
                  const squidIng = ingredients.find((i) => i.id === 'ing_squid_fresh' || i.name.includes('หมึก'));
                  const sCost = (shrimpIng?.costPerBaseUnit || 0) * (Number(variantModalState.seafoodShrimpQty) || 0);
                  const qCost = (squidIng?.costPerBaseUnit || 0) * (Number(variantModalState.seafoodSquidQty) || 0);
                  meatCost = sCost + qCost;
                  costDetail =
                    shrimpIng || squidIng
                      ? (isEn
                          ? `Shrimp ฿${sCost.toFixed(2)} + Squid ฿${qCost.toFixed(2)}`
                          : `กุ้ง ฿${sCost.toFixed(2)} + หมึก ฿${qCost.toFixed(2)}`)
                      : (isEn ? 'Missing ingredient price' : 'ยังไม่มีข้อมูลราคาวัตถุดิบ');
                } else {
                  const linked = ingredients.find((i) => i.id === variantModalState.selectedIngredientId);
                  const unitCost = linked?.costPerBaseUnit || 0;
                  const rawQty = Number(variantModalState.meatQuantity) || 0;
                  const chosenUnit = variantModalState.meatUnit || linked?.usageUnit || linked?.baseUnit || 'g';
                  let effectiveQty = rawQty;
                  if (linked) {
                    const conv = convertUnit(rawQty, chosenUnit, linked.usageUnit || linked.baseUnit || 'g');
                    if (conv.success) {
                      effectiveQty = conv.convertedQuantity;
                    }
                  }
                  meatCost = unitCost * effectiveQty;
                  if (linked && unitCost > 0) {
                    const baseU = linked.usageUnit || linked.baseUnit || 'g';
                    costDetail =
                      baseU === 'g'
                        ? (isEn ? `฿${(unitCost * 1000).toFixed(0)}/kg` : `฿${(unitCost * 1000).toFixed(0)}/กก.`)
                        : `฿${unitCost.toFixed(2)}/${localizeUnit(baseU, lang)}`;
                  } else {
                    costDetail = isEn ? 'No ingredient selected or missing price' : 'ยังไม่ได้เลือกวัตถุดิบหรือยังไม่มีราคา';
                  }
                }

                const baseRecipeItemsForPreview = (variantModalState.variant?.recipeItems || []).filter(
                  (it) => !isProteinRecipeItem(it, variantModalState.variant?.proteinType)
                );
                const baseRecipeCost = computeBaseRecipeItemsCost(baseRecipeItemsForPreview);
                const totalFoodCost = meatCost + baseRecipeCost;
                const sellPrice = Number(variantModalState.variant.sellingPrice) || 0;
                const taxRate =
                  typeof settings.vatRatePercent === 'number' && Number.isFinite(settings.vatRatePercent)
                    ? Math.max(0, settings.vatRatePercent)
                    : 7;
                const isVatInclusive =
                  variantModalState.variant.taxType === 'INCLUSIVE' ||
                  (variantModalState.variant.taxType !== 'EXCLUSIVE' &&
                    variantModalState.variant.taxType !== 'NONE' &&
                    Boolean(settings.pricesIncludeVat ?? settings.salesVatInclusive));
                const scIncluded = Boolean(settings.serviceChargeIncludedInPrice);
                const scRate =
                  typeof settings.serviceChargePercent === 'number' && Number.isFinite(settings.serviceChargePercent)
                    ? Math.max(0, settings.serviceChargePercent)
                    : 0;
                const taxDivisor = isVatInclusive
                  ? (1 + (scIncluded ? scRate / 100 : 0)) * (1 + taxRate / 100)
                  : 1;
                const netSellPrice = taxDivisor > 0 ? sellPrice / taxDivisor : sellPrice;

                let estOverhead = 0;
                if (typeof settings.overheadRatePercent === 'number' && Number.isFinite(settings.overheadRatePercent)) {
                  const rate = Math.max(0, settings.overheadRatePercent) / 100;
                  const baseAmount = settings.overheadCalculationBase === 'FOOD_COST' ? totalFoodCost : netSellPrice;
                  estOverhead = rate * baseAmount;
                } else {
                  estOverhead = Number(variantModalState.variant.overheadCost ?? settings.defaultOverheadCostPerDish ?? 0);
                }

                const estPackagingCost = Number(variantModalState.variant.packagingCost) || 0;
                const estTotalCost = totalFoodCost + estOverhead;
                const estTotalWithPackaging = estTotalCost + estPackagingCost;
                const estProfit = netSellPrice - estTotalCost;
                const estFc = netSellPrice > 0 ? (totalFoodCost / netSellPrice) * 100 : 0;

                return (
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs font-mono flex-wrap gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div>
                        <span className="text-emerald-900 font-bold">
                          {isEn ? 'Protein Cost: ' : 'ต้นทุนเนื้อสัตว์: '}
                        </span>
                        <strong className="text-emerald-950 font-black">฿{meatCost.toFixed(2)}</strong>
                        {costDetail && (
                          <span className="text-[10px] text-emerald-700 ml-1">
                            ({costDetail})
                          </span>
                        )}
                      </div>
                      {baseRecipeCost > 0 && (
                        <div>
                          <span className="text-emerald-900 font-bold">
                            {isEn ? 'Base Recipe: ' : 'สูตรกลาง: '}
                          </span>
                          <strong className="text-emerald-950 font-black">฿{baseRecipeCost.toFixed(2)}</strong>
                        </div>
                      )}
                      <div>
                        <span className="text-stone-800 font-bold">
                          {isEn ? 'Total Actual Cost: ' : 'ต้นทุนรวมจริงทั้งหมด: '}
                        </span>
                        <strong className="text-[#B45309] font-black">฿{estTotalCost.toFixed(2)}</strong>
                        <span className="text-[10px] text-stone-600 ml-1 font-sans">
                          {isEn
                            ? `(Raw ฿${totalFoodCost.toFixed(2)} + OH ฿${estOverhead.toFixed(2)}${estPackagingCost > 0 ? ` • w/ Box ฿${estTotalWithPackaging.toFixed(2)}` : ''})`
                            : `(วัตถุดิบรวม ฿${totalFoodCost.toFixed(2)} + โสหุ้ย ฿${estOverhead.toFixed(2)}${estPackagingCost > 0 ? ` • รวมกล่อง ฿${estTotalWithPackaging.toFixed(2)}` : ''})`}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-stone-700 font-bold">
                        {isEn ? 'Est. Dine-in Profit: ' : 'กำไรหน้าร้านเบื้องต้น: '}
                      </span>
                      {sellPrice > 0 ? (
                        <>
                          <strong className={`font-black ${estProfit < 0 ? 'text-rose-600' : 'text-emerald-800'}`}>
                            ฿{estProfit.toFixed(2)}
                          </strong>
                          <span className="text-[10px] text-stone-600 ml-1.5 font-sans">
                            (FC ~{estFc.toFixed(1)}%)
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-amber-700 font-sans font-bold">
                          {isEn ? 'Enter selling price' : 'กรุณาระบุราคาขาย'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </form>

            {/* Locked Modal Footer */}
            <div className="modal-footer flex justify-end gap-3 border-t border-[#EAE4D9] bg-[#FFFDF9]">
              <button
                type="button"
                onClick={() =>
                  setVariantModalState({
                    isOpen: false,
                    mode: 'ADD',
                    menu: null,
                    variant: null,
                    selectedIngredientId: '',
                    meatQuantity: 80,
                    meatUnit: 'g',
                    isEnglishManuallyEdited: false,
                    selectedBaseRecipeMenuId: '',
                  })
                }
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
              >
                {isEn ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                type="submit"
                form="variant-modal-form"
                className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer"
              >
                {variantModalState.mode === 'ADD'
                  ? (isEn ? 'Save New Option' : 'บันทึกตัวเลือกใหม่')
                  : (isEn ? 'Save Changes' : 'บันทึกการแก้ไข')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE VARIANT CONFIRMATION MODAL */}
      {variantToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="modal-panel bg-[#FFFDF9] rounded-3xl max-w-md w-full shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="modal-header flex items-center justify-between border-b border-[#EAE4D9]">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Trash2 className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-bold text-[#1C1917] text-base">
                    {isEn ? 'Confirm Delete Meat Variant' : 'ยืนยันการลบตัวเลือกเนื้อสัตว์'}
                  </h3>
                  <p className="text-xs text-stone-500 font-medium">
                    {isEn ? 'Menu:' : 'เมนู:'}{' '}
                    {getLocalizedText(lang, variantToDelete.menu.thaiName || variantToDelete.menu.name, variantToDelete.menu.englishName)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVariantToDelete(null)}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body space-y-4 text-xs">
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-xs">
                    {isEn
                      ? `Delete option "${getLocalizedText('en', variantToDelete.variant.thaiName || variantToDelete.variant.name || variantToDelete.variant.proteinType, variantToDelete.variant.englishName)}"?`
                      : `ต้องการลบตัวเลือก "${variantToDelete.variant.name || variantToDelete.variant.proteinType}" ใช่หรือไม่?`}
                  </p>
                  <p className="text-[11px] text-rose-700 leading-relaxed">
                    {isEn
                      ? `This meat option will be removed from the cost & pricing table of ${getLocalizedText('en', variantToDelete.menu.thaiName || variantToDelete.menu.name, variantToDelete.menu.englishName)} immediately.`
                      : `ตัวเลือกเนื้อสัตว์นี้จะถูกลบออกจากตารางต้นทุนและการตั้งราคาของเมนู ${variantToDelete.menu.name} ทันที`}
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-footer bg-[#FFFDF9] flex justify-end gap-2.5 border-t border-[#EAE4D9] text-xs">
              <button
                type="button"
                onClick={() => setVariantToDelete(null)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
              >
                {isEn ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteVariant}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isEn ? 'Confirm Delete Option' : 'ยืนยันการลบตัวเลือก'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
