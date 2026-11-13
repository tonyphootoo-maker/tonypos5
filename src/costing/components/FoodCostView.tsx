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
  calculateSuggestedPrices,
} from '../services/calculationEngine';
import { NumericInput } from './common/NumericInput';
import { MenuPricingSpreadsheetTable } from './MenuPricingSpreadsheetTable';

interface FoodCostViewProps {
  menus: MenuItem[];
  ingredients: Ingredient[];
  sauces: Sauce[];
  settings: RestaurantSettings;
  initialServingMode?: 'ON_RICE' | 'A_LA_CARTE';
  onSaveMenu: (menu: MenuItem) => void;
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
  initialServingMode,
  onSaveMenu,
  onDeleteMenu,
  onReorderMenus,
  onUpdateVariantPrice,
  onNavigateToRecipeBuilder,
}) => {
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

  // Variant Modal state (Add or Edit)
  const [variantModalState, setVariantModalState] = useState<{
    isOpen: boolean;
    mode: 'ADD' | 'EDIT';
    menu: MenuItem | null;
    variant: Partial<MenuVariant> | null;
    selectedCategory?: string;
    selectedIngredientId: string;
    meatQuantity: number;
    seafoodShrimpQty?: number;
    seafoodSquidQty?: number;
  }>({
    isOpen: false,
    mode: 'ADD',
    menu: null,
    variant: null,
    selectedCategory: 'เนื้อสัตว์และอาหารทะเล',
    selectedIngredientId: '',
    meatQuantity: 80,
    seafoodShrimpQty: 4,
    seafoodSquidQty: 40,
  });

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

  // All unique ingredient categories
  const ingredientCategories = useMemo(() => {
    const set = new Set<string>();
    ingredients.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set);
  }, [ingredients]);

  // Filtered ingredients according to selected category in variant modal
  const currentCategoryIngredients = useMemo(() => {
    const cat = variantModalState.selectedCategory || 'เนื้อสัตว์และอาหารทะเล';
    if (cat === 'ALL') return ingredients;
    return ingredients.filter((i) => i.category === cat);
  }, [ingredients, variantModalState.selectedCategory]);

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
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // Modal state for editing existing category
  const [isEditCategoryModalOpen, setIsEditCategoryModalOpen] = useState(false);
  const [editingCategoryOldName, setEditingCategoryOldName] = useState('');
  const [editingCategoryNewName, setEditingCategoryNewName] = useState('');
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
      setCategoryError('กรุณากรอกชื่อหมวดหมู่');
      return;
    }
    if (categories.includes(trimmed)) {
      setCategoryError('มีหมวดหมู่นี้อยู่ในระบบแล้ว');
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
    setCategoryError(null);
    setIsAddCategoryModalOpen(false);
  };

  const handleOpenEditCategory = (categoryName: string) => {
    if (!categoryName || categoryName === 'ALL') return;
    setEditingCategoryOldName(categoryName);
    setEditingCategoryNewName(categoryName);
    setEditCategoryError(null);
    setIsEditCategoryModalOpen(true);
  };

  const handleSaveEditCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = editingCategoryNewName.trim();
    if (!trimmed) {
      setEditCategoryError('กรุณากรอกชื่อหมวดหมู่');
      return;
    }
    if (trimmed !== editingCategoryOldName && categories.includes(trimmed)) {
      setEditCategoryError('มีหมวดหมู่นี้อยู่ในระบบแล้ว');
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
      const breakdown = calculateVariantCostBreakdown(
        variant,
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
  const filteredRows = allRows.filter(({ menu, variant }) => {
    const matchesCategory =
      selectedCategory === 'ALL' || menu.category === selectedCategory;
    const matchesSearch =
      menu.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      variant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      variant.proteinType.toLowerCase().includes(searchTerm.toLowerCase());
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
          reasons.push(`Food Cost สูงมาก (${r.breakdown.restaurantFoodCostPercent.toFixed(1)}% > 40%)`);
        } else if (r.breakdown.restaurantFoodCostPercent > target) {
          reasons.push(`Food Cost เกินเป้า (${r.breakdown.restaurantFoodCostPercent.toFixed(1)}% > ${target}%)`);
        }
        if (r.breakdown.restaurantProfit < 0) {
          reasons.push(`กำไรหน้าร้านติดลบ (${r.breakdown.restaurantProfit.toFixed(1)} ฿)`);
        }
        if (r.breakdown.deliveryProfit < 0) {
          reasons.push(`กำไรเดลิเวอรี่ติดลบ (${r.breakdown.deliveryProfit.toFixed(1)} ฿)`);
        }
        if (r.breakdown.hasMissingPrice || r.breakdown.missingPrice) {
          reasons.push('ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง');
        }
        if (r.breakdown.hasReviewIssue && !r.breakdown.hasMissingPrice) {
          reasons.push(r.breakdown.reviewMessage || 'ต้องทบทวนสูตรหรือวัตถุดิบ');
        }
        return {
          ...r,
          reasons,
        };
      });
  }, [allRows, settings.targetFoodCostPercent]);

  // Set of menu IDs that have high cost (> 40% or > target) or review issue or negative margin
  const warningMenuIds = useMemo(() => {
    return new Set(warningRows.map((r) => r.menu.id));
  }, [warningRows]);

  const filteredMenus = menus.filter((m) => {
    const matchesCategory = selectedCategory === 'ALL' || m.category === selectedCategory;
    const matchesSearch =
      !searchTerm ||
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.variants.some((v) => v.name.toLowerCase().includes(searchTerm.toLowerCase()));
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
    const currentCat =
      selectedCategory !== 'ALL'
        ? selectedCategory
        : (categories.find((c) => c !== 'ALL') || 'ผัดและกะเพรา');

    const newMenu: Partial<MenuItem> = {
      id: `menu_${Date.now()}`,
      name: '',
      category: currentCat,
      variants: [
        {
          id: `var_${Date.now()}_1`,
          menuId: `menu_${Date.now()}`,
          name: 'ธรรมดา',
          proteinType: 'หมูสับ',
          sellingPrice: 60,
          takeawayPrice: 65,
          deliveryPrice: 85,
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
    setEditingMenu(JSON.parse(JSON.stringify(menu)));
    setIsMenuModalOpen(true);
  };

  const handleSaveMenuModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMenu || !editingMenu.name) return;

    const finalMenu: MenuItem = {
      id: editingMenu.id || `menu_${Date.now()}`,
      name: editingMenu.name.trim(),
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
    const initialQty = defaultIng?.usageUnit === 'ตัว' || defaultIng?.baseUnit === 'ตัว' ? 4 : 80;

    const newVariant: Partial<MenuVariant> = {
      id: `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      menuId: menu.id,
      name: `${menu.name} ${defaultProtein}`,
      proteinType: defaultProtein,
      sellingPrice: 65,
      takeawayPrice: 70,
      deliveryPrice: 89,
      grabPrice: 89,
      linemanPrice: 89,
      robinhoodPrice: 65,
      overheadCost: 6.0,
      packagingCost: 9.0,
      recipeItems: defaultIng
        ? [
            {
              ingredientId: defaultIng.id,
              name: defaultIng.name,
              quantity: initialQty,
              unit: defaultIng.usageUnit || 'g',
              calculatedUnitCost: defaultIng.costPerBaseUnit || 0,
              calculatedLineCost: Number(((defaultIng.costPerBaseUnit || 0) * initialQty).toFixed(2)),
            },
          ]
        : [],
      active: true,
    };

    setVariantModalState({
      isOpen: true,
      mode: 'ADD',
      menu,
      variant: newVariant,
      selectedCategory: defaultIng?.category || 'เนื้อสัตว์และอาหารทะเล',
      selectedIngredientId: defaultIng ? defaultIng.id : '',
      meatQuantity: initialQty,
      seafoodShrimpQty: 4,
      seafoodSquidQty: 40,
    });
  };

  const handleOpenEditVariant = (menu: MenuItem, variant: MenuVariant) => {
    // Detect linked ingredient if exists
    let matchedIngId = '';
    const proteinItem = (variant.recipeItems || []).find((it) => {
      const lower = (it.name || '').toLowerCase();
      return (
        lower.includes('หมู') ||
        lower.includes('ไก่') ||
        lower.includes('เนื้อ') ||
        lower.includes('กุ้ง') ||
        lower.includes('หมึก') ||
        lower.includes('ไส้กรอก') ||
        lower.includes('ปลา')
      );
    }) || (variant.recipeItems && variant.recipeItems[0]);

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

    setVariantModalState({
      isOpen: true,
      mode: 'EDIT',
      menu,
      variant: JSON.parse(JSON.stringify(variant)),
      selectedCategory: isSeafoodItem ? 'เนื้อสัตว์และอาหารทะเล' : (matchedIng?.category || 'เนื้อสัตว์และอาหารทะเล'),
      selectedIngredientId: isSeafoodItem ? 'seafood_combo' : matchedIngId,
      meatQuantity: defaultQty,
      seafoodShrimpQty: existingShrimp?.quantity || 4,
      seafoodSquidQty: existingSquid?.quantity || 40,
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
    const pType = v.proteinType?.trim() || 'หมูสับ';
    const isSeafoodSelected =
      pType.includes('ทะเล') ||
      pType.includes('ซีฟู้ด') ||
      variantModalState.selectedIngredientId === 'seafood_combo';

    const linkedIng = ingredients.find((i) => i.id === variantModalState.selectedIngredientId);
    const qty = Number(variantModalState.meatQuantity) || (pType.includes('กุ้ง') ? 4 : 80);

    // Keep existing non-protein recipe items if any
    const existingOtherItems = (v.recipeItems || []).filter((it) => {
      const lower = (it.name || '').toLowerCase();
      return !(
        lower.includes('หมู') ||
        lower.includes('ไก่') ||
        lower.includes('เนื้อ') ||
        lower.includes('กุ้ง') ||
        lower.includes('หมึก') ||
        lower.includes('ไส้กรอก') ||
        lower.includes('ปลา')
      );
    });

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
      const proteinRecipeItem: RecipeItem = {
        ingredientId: linkedIng ? linkedIng.id : '',
        name: linkedIng ? linkedIng.name : pType,
        quantity: qty,
        unit: (linkedIng?.usageUnit as any) || (linkedIng?.baseUnit as any) || 'g',
        calculatedUnitCost: linkedIng?.costPerBaseUnit || 0,
        calculatedLineCost: Number(((linkedIng?.costPerBaseUnit || 0) * qty).toFixed(2)),
      };
      finalRecipeItems = [proteinRecipeItem, ...existingOtherItems];
    }

    const finalVariant: MenuVariant = {
      id: v.id || `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      menuId: targetMenu.id,
      code: v.code?.trim() || undefined,
      sku: v.sku?.trim() || v.code?.trim() || undefined,
      barcode: v.barcode?.trim() || undefined,
      name: v.name?.trim() || `${targetMenu.name} ${pType}`,
      proteinType: pType,
      sellingPrice: Number(v.sellingPrice) || 60,
      takeawayPrice: Number(v.takeawayPrice) || Number(v.sellingPrice) || 65,
      deliveryPrice: Number(v.deliveryPrice) || Number(v.sellingPrice) || 85,
      grabPrice: Number(v.grabPrice) || Math.round((Number(v.sellingPrice) || 60) * 1.5) || 89,
      linemanPrice: Number(v.linemanPrice) || Math.round((Number(v.sellingPrice) || 60) * 1.5) || 89,
      robinhoodPrice: Number(v.robinhoodPrice) || Number(v.sellingPrice) || 65,
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
    });
  };

  // Packaging Line Items Management for Sub-Items
  const handleAddPackagingLine = () => {
    if (!selectedBreakdown) return;
    const { menu, variant } = selectedBreakdown;
    const currentItems = variant.packagingItems ? [...variant.packagingItems] : [];
    const newLine = {
      id: `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: 'กล่องข้าว',
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

  return (
    <div className="space-y-4 pb-8">
      {/* Consolidated Ultra-Compact Control Header */}
      <div className="bg-white border border-stone-300 rounded-2xl shadow-xs p-2.5 sm:p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left section: Title + Metrics */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 font-black text-stone-900 text-sm sm:text-base mr-1">
              <UtensilsCrossed className="w-4 h-4 text-[#F27D26]" />
              <span>ต้นทุนอาหาร</span>
            </div>

            {/* Metric 1: Avg Food Cost (Compact) */}
            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-300 rounded-xl text-xs text-stone-900">
              <span className="text-stone-700 font-bold">Food Cost เฉลี่ย:</span>
              <span className="font-mono font-black text-amber-800">
                {avgFoodCostPercent.toFixed(1)}%
              </span>
              <span className="text-[10px] text-stone-500 hidden md:inline">
                (เป้า {settings.targetFoodCostPercent || 35}%)
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
                  ? "คลิกเพื่อยกเลิกการกรอง และแสดงเมนูทั้งหมด"
                  : "คลิกเพื่อแสดงเฉพาะเมนูต้นทุนสูง / ควรทบทวน ทันที"
              }
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${filterHighCostOnly ? "text-white" : "text-rose-600"}`} />
              <span className="whitespace-nowrap">เมนูต้นทุนสูง / ควรทบทวน:</span>
              <span className={`px-1.5 py-0.2 rounded-md font-mono font-black text-xs ${
                filterHighCostOnly ? "bg-white text-rose-700" : "bg-rose-600 text-white"
              }`}>
                {warningCount} รายการ
              </span>
              {filterHighCostOnly ? (
                <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-white text-rose-700 font-extrabold">
                  ✕ ยกเลิกกรอง
                </span>
              ) : (
                <span className="text-[10px] text-rose-700 font-bold hidden sm:inline underline underline-offset-2">
                  (คลิกดูทันที)
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
              <span>+ เพิ่มเมนูใหม่</span>
            </button>
          </div>
        </div>
      </div>


      {/* Active High-Cost Filter Alert Banner (Displayed when filtering warning items) */}
      {filterHighCostOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 sm:p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-950 text-xs shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-bold">
              กำลังแสดงเฉพาะเมนูที่มีการแจ้งเตือน ({warningMenuIds.size} เมนู, {warningRows.length} รายการตัวเลือก)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsWarningModalOpen(true)}
              className="px-2.5 py-1 bg-white hover:bg-rose-100 border border-rose-300 text-rose-900 font-black rounded-lg cursor-pointer"
            >
              ดูรายการแจ้งเตือนทั้งหมด ({warningRows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterHighCostOnly(false)}
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-lg cursor-pointer"
            >
              ✕ ยกเลิกกรอง (แสดงทุกเมนู)
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
              <div>
                <h2 className="text-sm font-black text-stone-900">รายการเมนูอาหาร</h2>
                <p className="text-[11px] text-stone-500 mt-0.5">คลิกเมนูเพื่อดูรายละเอียดตัวเลือกเนื้อสัตว์และตารางต้นทุน</p>
              </div>
              <span className="text-xs font-mono font-bold text-stone-600">{filteredMenus.length} เมนู</span>
            </div>

            <div className="divide-y divide-stone-200">
              {filteredMenus.map((menu, mIdx) => {
                const isSelected = selectedMenuId === menu.id;
                const hasWarning = warningMenuIds.has(menu.id);
                const isDragging = draggedMenuId === menu.id;
                const isDragOver = dragOverMenuId === menu.id;

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
                          title="กดเมาส์ค้างไว้เพื่อลากย้ายตำแหน่งเมนู"
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
                            title="ย้ายขึ้น"
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
                            title="ย้ายลง"
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
                          <span className="text-sm font-bold text-stone-900 truncate">{menu.name}</span>
                          <span className="text-[11px] text-stone-500 font-medium">
                            ({menu.variants.length} ตัวเลือก)
                          </span>
                          {hasWarning && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-600 !text-white shadow-2xs flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-white" />
                              <span>ต้นทุนสูง / ควรทบทวน</span>
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
                        title="แก้ไขเมนู"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuToDelete(menu)}
                        className="p-1.5 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0 transition-colors"
                        title="ลบเมนู"
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
          <div className="bg-[#FFFDF9] rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-[#EAE4D9] text-[#1C1917] max-h-[90vh] overflow-y-auto scrollbar-thin">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-stone-900 text-lg">
                    {selectedBreakdown.menu.name} ({selectedBreakdown.variant.name})
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-300">
                    {selectedBreakdown.menu.category}
                  </span>
                </div>
                <p className="text-xs text-stone-600 mt-0.5">
                  รายละเอียดการคำนวณต้นทุนต่อจานอย่างละเอียด (Deterministic Costing)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBreakdown(null)}
                className="p-1 rounded-xl text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mt-3 text-xs">
              {/* SEAFOOD RULE HIGHLIGHT CARD */}
              {isSeafoodVariant(selectedBreakdown.breakdown) && (
                <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5">
                  <div className="flex items-center gap-2 text-sm font-black text-amber-900 mb-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>Seafood Rule: คำนวณกุ้งและปลาหมึกแยกจากกันเด็ดขาด</span>
                  </div>
                  <p className="text-[11px] text-stone-700 mb-3">
                    ตามกฎความถูกต้องทางบัญชีของร้าน: กุ้งต้องคำนวณเป็น 'ตัว' และปลาหมึกต้องคำนวณเป็น 'กรัม'
                    (ห้ามรวมเป็น 'ทะเล' รายการเดียว หรือใช้การประมาณ)
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                    <div className="bg-white p-3 rounded-xl border border-stone-300 shadow-2xs">
                      <span className="text-[11px] font-sans text-stone-700 block font-bold">🦐 กุ้งสด</span>
                      <span className="text-base font-black text-stone-950 mt-1 block">
                        ฿{selectedBreakdown.breakdown.shrimpCost.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-stone-500">คิดเป็นตัว (ไม่แปลงเป็นกรัม)</span>
                    </div>

                    <div className="bg-white p-3 rounded-xl border border-stone-300 shadow-2xs">
                      <span className="text-[11px] font-sans text-stone-700 block font-bold">🦑 ปลาหมึกสด</span>
                      <span className="text-base font-black text-stone-950 mt-1 block">
                        ฿{selectedBreakdown.breakdown.squidCost.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-stone-500">
                        คิดเป็นกรัม (คำนวณ Yield ลอกหนัง 65%)
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between font-mono text-xs">
                    <span className="font-sans text-stone-800 font-bold">รวมต้นทุนอาหารทะเลทั้งจาน:</span>
                    <span className="font-black text-stone-950 text-sm">
                      ฿{selectedBreakdown.breakdown.seafoodTotalCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Recipe Items Breakdown Table */}
              <div>
                <span className="font-black text-stone-900 block mb-1.5">
                  ส่วนประกอบและวัตถุดิบในจาน (Recipe Items)
                </span>
                <div className="bg-white border border-stone-300 rounded-2xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-stone-100 border-b border-stone-300 text-stone-700 text-[10px] uppercase font-bold">
                        <th className="py-2 px-3">วัตถุดิบ / ส่วนประกอบ</th>
                        <th className="py-2 px-2">ประเภท</th>
                        <th className="py-2 px-2 text-right">ปริมาณ</th>
                        <th className="py-2 px-2 text-right">ต้นทุน/หน่วย</th>
                        <th className="py-2 px-3 text-right">รวมเงิน (฿)</th>
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

                          // If shrimp is missing from items but has cost or default, add it
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

                          // If squid is missing from items but has cost or default, add it
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

                          // Remove single generic "ทะเล" if it exists
                          displayItems = displayItems.filter(
                            (it) => it.proteinCategory === 'SHRIMP' || it.proteinCategory === 'SQUID' || (it.name !== 'ทะเล' && it.name !== selectedBreakdown.variant.proteinType)
                          );
                        }

                        return displayItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-stone-50">
                          <td className="py-2 px-3 font-sans text-stone-900 font-bold">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{item.name}</span>
                              {((item as any).missingPrice || !(item.calculatedUnitCost && item.calculatedUnitCost > 0)) && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-700 border border-amber-500/30">
                                  ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 font-sans text-stone-600 text-[10px]">
                            {item.type === 'SAUCE' ? 'ซอส' : 'วัตถุดิบ'}
                          </td>
                          <td className="py-2 px-2 text-right text-stone-800 font-semibold">
                            {item.quantity} {item.unit}
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-cyan-700" />
                    <span className="font-black text-stone-900 text-xs">
                      ต้นทุนกล่อง & บรรจุภัณฑ์ (Packaging Items)
                    </span>
                    <span className="text-[10px] text-stone-500">
                      (กำหนดเฉพาะตัวเลือกนี้)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPackagingLine}
                    className="px-2.5 py-1 bg-cyan-700 hover:bg-cyan-800 !text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ เพิ่มแพ็กเกจจิ้ง</span>
                  </button>
                </div>

                {(!selectedBreakdown.variant.packagingItems || selectedBreakdown.variant.packagingItems.length === 0) ? (
                  <div className="p-3 text-center text-stone-500 text-xs border border-dashed border-stone-300 rounded-xl bg-stone-50">
                    ยังไม่มีรายการแพ็กเกจจิ้ง (กดปุ่ม "+ เพิ่มแพ็กเกจจิ้ง" ด้านบนเพื่อระบุ เช่น กล่องข้าว, ถุงพลาสติก, ช้อนส้อม)
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
                            placeholder="ชื่อแพ็กเกจจิ้ง เช่น กล่องข้าว, ถุงหิ้ว"
                            onChange={(e) => handleUpdatePackagingLine(pIdx, 'name', e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#F27D26]"
                          />
                          <datalist id={`pkg-common-${pIdx}`}>
                            <option value="กล่องข้าว" />
                            <option value="กล่องกระดาษรักษ์โลก" />
                            <option value="ถุงพลาสติกหิ้ว" />
                            <option value="ถุงกระดาษ" />
                            <option value="ชุดช้อนส้อมพลาสติก" />
                            <option value="กระปุกน้ำจิ้ม / ถ้วยซอส" />
                            <option value="กระดาษทิชชู่ / สติกเกอร์" />
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
                            className="w-full pl-2 pr-6 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono font-bold text-stone-900 text-right focus:outline-none focus:border-[#F27D26]"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-stone-500 font-bold">
                            บาท
                          </span>
                        </div>

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={() => handleDeletePackagingLine(pIdx)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="ลบรายการนี้"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}

                    <div className="flex justify-between items-center px-3 py-2 bg-cyan-50 border border-cyan-200 rounded-xl text-xs font-mono">
                      <span className="font-sans text-stone-800 font-bold">โสหุ้ยแพ็กเกจจิ้งรวม (Total packaging cost):</span>
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
                  <span className="text-[10px] font-sans text-stone-600 block font-bold">ต้นทุนวัตถุดิบรวม</span>
                  <span className="text-base font-black text-stone-950 block mt-0.5">
                    ฿{selectedBreakdown.breakdown.totalIngredientCost.toFixed(2)}
                  </span>
                </div>

                <div className="bg-stone-100 p-2.5 rounded-xl border border-stone-300">
                  <span className="text-[10px] font-sans text-stone-600 block font-bold">ค่าโสหุ้ยต่อจาน</span>
                  <span className="text-base font-black text-stone-950 block mt-0.5">
                    ฿{selectedBreakdown.breakdown.overheadCost.toFixed(2)}
                  </span>
                </div>

                <div className="bg-cyan-50 p-2.5 rounded-xl border border-cyan-300">
                  <span className="text-[10px] font-sans text-cyan-900 block font-bold">แพ็กเกจจิ้งรวม</span>
                  <span className="text-base font-black text-cyan-900 block mt-0.5">
                    ฿{(selectedBreakdown.breakdown.packagingCost || 0).toFixed(2)}
                  </span>
                </div>

                <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-300">
                  <span className="text-[10px] font-sans text-amber-900 block font-bold">ต้นทุนรวมสุทธิ</span>
                  <span className="text-base font-black text-amber-950 block mt-0.5">
                    ฿{selectedBreakdown.breakdown.totalCost.toFixed(2)}
                  </span>
                </div>

                <div className="bg-stone-100 p-2.5 rounded-xl border border-stone-300">
                  <span className="text-[10px] font-sans text-stone-600 block font-bold">Food Cost หน้าร้าน</span>
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
                const grabProfit =
                  selectedBreakdown.variant.deliveryPrice -
                  selectedBreakdown.variant.deliveryPrice * (grabCommissionPct / 100) -
                  baseCost -
                  pkgCostToUse;
                const linemanProfit =
                  selectedBreakdown.variant.deliveryPrice -
                  selectedBreakdown.variant.deliveryPrice * (linemanCommissionPct / 100) -
                  baseCost -
                  pkgCostToUse;

                return (
                  <div className="bg-stone-100 border border-stone-300 rounded-2xl p-3.5">
                    <span className="font-black text-stone-900 block mb-2 font-sans">
                      เปรียบเทียบกำไรสุทธิแยกตามช่องทาง Delivery
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                      {/* GrabFood Card */}
                      <div className="p-3 rounded-xl bg-white border border-[#00B14F]/40 shadow-2xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-sans font-black text-[#00873e]">GrabFood</span>
                          <span className="text-[10px] text-stone-500 font-bold">GP {grabCommissionPct}%</span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="font-sans text-stone-600">ราคาขาย:</span>
                            <span className="text-stone-900 font-bold">
                              ฿{selectedBreakdown.variant.deliveryPrice}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">หัก GP ({grabCommissionPct}%):</span>
                            <span>
                              -฿
                              {(
                                selectedBreakdown.variant.deliveryPrice *
                                (grabCommissionPct / 100)
                              ).toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">ค่ากล่อง Delivery:</span>
                            <span>-฿{pkgCostToUse.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-stone-200 font-bold">
                            <span className="font-sans text-stone-800">กำไรสุทธิหลัง GP:</span>
                            <span className={`font-black ${grabProfit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                              ฿{grabProfit.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* LINE MAN Card */}
                      <div className="p-3 rounded-xl bg-white border border-[#05963c]/40 shadow-2xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-sans font-black text-[#05963c]">LINE MAN</span>
                          <span className="text-[10px] text-stone-500 font-bold">GP {linemanCommissionPct}%</span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="font-sans text-stone-600">ราคาขาย:</span>
                            <span className="text-stone-900 font-bold">
                              ฿{selectedBreakdown.variant.deliveryPrice}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">หัก GP ({linemanCommissionPct}%):</span>
                            <span>
                              -฿
                              {(
                                selectedBreakdown.variant.deliveryPrice *
                                (linemanCommissionPct / 100)
                              ).toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-rose-600 font-semibold">
                            <span className="font-sans text-stone-600">ค่ากล่อง Delivery:</span>
                            <span>-฿{pkgCostToUse.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-stone-200 font-bold">
                            <span className="font-sans text-stone-800">กำไรสุทธิหลัง GP:</span>
                            <span className={`font-black ${linemanProfit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                              ฿{linemanProfit.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Dynamic Suggested Price by Target Food Cost */}
              <div className="bg-stone-100 border border-stone-300 rounded-2xl p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-black text-stone-900 font-sans">
                    💡 เครื่องคำนวณราคาขายแนะนำ (Suggested Price Calculator)
                  </span>
                  <span className="font-mono text-amber-800 font-black">
                    เป้าหมาย FC: {customTargetFcPercent}%
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
                    ราคาขายหน้าร้านที่แนะนำ (เพื่อให้ได้ FC {customTargetFcPercent}%):
                  </span>
                  <span className="text-base font-black text-stone-950">
                    ฿{(selectedBreakdown.breakdown.totalCost / (customTargetFcPercent / 100)).toFixed(0)} บาท
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-between items-center pt-3 border-t border-stone-200">
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
                  <span>ไปที่หน้าปรับแต่งสูตรอาหาร</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedBreakdown(null)}
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] !text-white font-black rounded-xl cursor-pointer shadow-xs"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MENU MODAL */}
      {isMenuModalOpen && editingMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="flex items-center justify-between border-b border-[#EAE4D9] pb-3">
              <h3 className="font-bold text-[#1C1917] text-base">
                {editingMenu.id?.startsWith('menu_') && !menus.find((m) => m.id === editingMenu.id)
                  ? 'เพิ่มเมนูใหม่'
                  : 'แก้ไขข้อมูลเมนู'}
              </h3>
              <button
                type="button"
                onClick={() => setIsMenuModalOpen(false)}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuModal} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block text-stone-700 mb-1.5 font-bold text-sm">
                  ชื่อเมนูอาหาร <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="เช่น ข้าวกะเพราโบราณ, ข้าวผัดพริกเผา"
                  value={editingMenu.name || ''}
                  onChange={(e) => setEditingMenu({ ...editingMenu, name: e.target.value })}
                  className="w-full p-3 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-sm font-medium focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-700 mb-1 font-bold text-xs">
                    รหัสเมนู / SKU (เชื่อม POS)
                  </label>
                  <input
                    type="text"
                    placeholder="เช่น MK-01, KPR"
                    value={editingMenu.code || editingMenu.sku || ''}
                    onChange={(e) => setEditingMenu({ ...editingMenu, code: e.target.value, sku: e.target.value })}
                    className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-mono font-semibold focus:outline-none focus:border-[#F27D26]"
                  />
                </div>
                <div>
                  <label className="block text-stone-700 mb-1 font-bold text-xs">
                    บาร์โค้ด (Barcode)
                  </label>
                  <input
                    type="text"
                    placeholder="เช่น 885001234567"
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
                    ⚠️ วัตถุดิบหมด / งดขายเมนูนี้ชั่วคราว (Out of Stock สำหรับ POS)
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => setIsMenuModalOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer"
                >
                  บันทึกเมนู
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ADD CATEGORY MODAL */}
      {isAddCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="flex items-center justify-between border-b border-[#EAE4D9] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-[#F27D26]/10 text-[#F27D26] flex items-center justify-center font-bold">
                  <FolderPlus className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">
                  เพิ่มหมวดหมู่อาหารใหม่
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddCategoryModalOpen(false);
                  setCategoryError(null);
                  setNewCategoryInput('');
                }}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block text-stone-700 mb-1.5 font-semibold">
                  ชื่อหมวดหมู่ใหม่ (Category Name)
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="เช่น ของหวาน, เครื่องดื่ม, กับแกล้ม, สเต็ก"
                  value={newCategoryInput}
                  onChange={(e) => {
                    setNewCategoryInput(e.target.value);
                    if (categoryError) setCategoryError(null);
                  }}
                  className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 focus:outline-none focus:border-[#F27D26] font-medium text-xs"
                />
                {categoryError && (
                  <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                    {categoryError}
                  </p>
                )}
              </div>

              {/* Quick Suggestions Chips */}
              <div>
                <span className="text-[10px] text-stone-500 font-semibold block mb-1.5">
                  หรือเลือกจากหมวดหมู่แนะนำ:
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
                        if (categoryError) setCategoryError(null);
                      }}
                      className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded-lg text-[11px] text-stone-700 font-medium transition-colors cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddCategoryModalOpen(false);
                    setCategoryError(null);
                    setNewCategoryInput('');
                  }}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-md shadow-[#F27D26]/20 cursor-pointer"
                >
                  บันทึกหมวดหมู่
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CATEGORY MODAL */}
      {isEditCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="flex items-center justify-between border-b border-[#EAE4D9] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-[#F27D26]/10 text-[#F27D26] flex items-center justify-center font-bold">
                  <Edit2 className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">
                  แก้ไขชื่อหมวดหมู่
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

            <form onSubmit={handleSaveEditCategory} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block text-stone-700 mb-1.5 font-semibold">
                  ชื่อหมวดหมู่ (Category Name)
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={editingCategoryNewName}
                  onChange={(e) => {
                    setEditingCategoryNewName(e.target.value);
                    if (editCategoryError) setEditCategoryError(null);
                  }}
                  className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 focus:outline-none focus:border-[#F27D26] font-medium text-xs"
                />
                {editCategoryError && (
                  <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                    {editCategoryError}
                  </p>
                )}
              </div>

              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 leading-relaxed">
                เมนูอาหารในหมวดหมู่เดิม <strong>"{editingCategoryOldName}"</strong> (จำนวน {menus.filter((m) => m.category === editingCategoryOldName).length} รายการ) จะถูกเปลี่ยนเป็นชื่อหมวดหมู่ใหม่นี้โดยอัตโนมัติ
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditCategoryModalOpen(false);
                    setEditCategoryError(null);
                  }}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-md shadow-[#F27D26]/20 cursor-pointer"
                >
                  บันทึกการแก้ไข
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CATEGORY MODAL */}
      {isDeleteCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="flex items-center justify-between border-b border-[#EAE4D9] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Trash2 className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">
                  ยืนยันการลบหมวดหมู่
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

            <div className="space-y-4 mt-4 text-xs">
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-xs">
                    ต้องการลบหมวดหมู่ "{deletingCategoryName}" ใช่หรือไม่?
                  </p>
                  {menus.filter((m) => m.category === deletingCategoryName).length > 0 ? (
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      มีเมนูอาหารในหมวดหมู่นี้อยู่ <strong>{menus.filter((m) => m.category === deletingCategoryName).length} รายการ</strong> ซึ่งเมนูเหล่านี้จะถูกย้ายไปยังหมวดหมู่ <strong>"ทั่วไป / อื่นๆ"</strong> โดยอัตโนมัติ (เมนูจะไม่สูญหาย)
                    </p>
                  ) : (
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      ไม่มีเมนูอาหารในหมวดหมู่นี้ ระบบจะลบหมวดหมู่นี้ออกจากตัวเลือกทั้งหมดทันที
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => setIsDeleteCategoryModalOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteCategory}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ยืนยันการลบหมวดหมู่</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WARNING REVIEW MODAL (Requirement 3: Displays all alerted items immediately) */}
      {isWarningModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-stone-300 text-stone-900 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-200 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-xs shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="font-black text-stone-950 text-base sm:text-lg flex items-center gap-2">
                    <span>รายการเมนูต้นทุนสูง / ควรทบทวน</span>
                    <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-xs font-mono font-black">
                      {warningRows.length} รายการ
                    </span>
                  </h3>
                  <p className="text-xs text-stone-600 font-medium mt-0.5">
                    เมนูที่มี Food Cost สูงเกินเป้า ({settings.targetFoodCostPercent || 35}%), กำไรติดลบ หรือสูตรต้องตรวจสอบ
                  </p>
                </div>
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
            <div className="space-y-3 mt-4 overflow-y-auto flex-1 pr-1">
              {warningRows.length === 0 ? (
                <div className="text-center py-10 text-stone-500">
                  <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-2" />
                  <p className="font-bold text-stone-800">ยอดเยี่ยมมาก! ไม่มีเมนูที่ต้นทุนสูงเกินเกณฑ์ในขณะนี้</p>
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
                          {item.menu.name}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-stone-100 border border-stone-200 text-stone-800 font-bold rounded-lg">
                          {item.variant.name}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 bg-stone-50 border border-stone-200 text-stone-600 rounded-md">
                          {item.menu.category}
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
                        <span>ราคาขาย: <strong className="text-stone-950 font-black">{item.breakdown.sellingPrice} ฿</strong></span>
                        <span>ต้นทุนรวม: <strong className="text-stone-950 font-black">{item.breakdown.totalCost.toFixed(1)} ฿</strong></span>
                        <span>
                          กำไรหน้าร้าน:{' '}
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
                        <span>ดูสูตรและต้นทุน</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-3 border-t border-stone-200 shrink-0 text-xs">
              <span className="font-mono font-bold text-stone-600">
                พบทั้งหมด {warningRows.length} รายการที่เข้าเกณฑ์
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
                  กรองเฉพาะเมนูเตือนในหน้านี้
                </button>
                <button
                  type="button"
                  onClick={() => setIsWarningModalOpen(false)}
                  className="px-3.5 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold rounded-xl cursor-pointer"
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE MENU CONFIRMATION MODAL */}
      {menuToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="flex items-center justify-between border-b border-[#EAE4D9] pb-3">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Trash2 className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-[#1C1917] text-base">ยืนยันการลบเมนูอาหาร</h3>
              </div>
              <button
                type="button"
                onClick={() => setMenuToDelete(null)}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4 mt-4 text-xs">
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-xs">
                    ต้องการลบเมนู "{menuToDelete.name}" ใช่หรือไม่?
                  </p>
                  <p className="text-[11px] text-rose-700 leading-relaxed">
                    ตัวเลือกเนื้อสัตว์และข้อมูลต้นทุนทั้งหมด ({menuToDelete.variants.length} รายการ) ในเมนูนี้จะถูกลบออกด้วย
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => setMenuToDelete(null)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
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
                  <span>ยืนยันการลบเมนู</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT VARIANT MODAL (เชื่อมโยงกับข้อมูลวัตถุดิบจริง) */}
      {variantModalState.isOpen && variantModalState.menu && variantModalState.variant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-stone-300 text-stone-900 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-[#F27D26]/15 border border-[#F27D26]/30 text-[#F27D26] flex items-center justify-center font-bold">
                  <UtensilsCrossed className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-black text-stone-950 text-base">
                    {variantModalState.mode === 'ADD'
                      ? '+ เพิ่มตัวเลือกเนื้อสัตว์ใหม่'
                      : 'แก้ไขตัวเลือกเนื้อสัตว์'}
                  </h3>
                  <p className="text-xs text-stone-500 font-medium">
                    เมนู: <strong className="text-stone-800">{variantModalState.menu.name}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setVariantModalState({ isOpen: false, mode: 'ADD', menu: null, variant: null, selectedIngredientId: '', meatQuantity: 80 })
                }
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVariantModal} className="space-y-4 mt-4 text-xs">
              {/* 1. เลือกประเภทวัตถุดิบ/เนื้อสัตว์จากฐานข้อมูล (เลือกหมวดหมู่ก่อน แล้วเลือกวัตถุดิบย่อย) */}
              <div className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-stone-900 font-black text-xs">
                    เลือกวัตถุดิบจากฐานข้อมูล <span className="text-[#F27D26]">*</span>
                  </label>
                  <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300">
                    เชื่อมโยงต้นทุนจริงอัตโนมัติ
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* ขั้นที่ 1: เลือกหมวดหมู่วัตถุดิบ */}
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      1. เลือกหมวดหมู่วัตถุดิบก่อน <span className="text-[#F27D26]">*</span>
                    </label>
                    <select
                      value={variantModalState.selectedCategory || 'เนื้อสัตว์และอาหารทะเล'}
                      onChange={(e) => {
                        const newCat = e.target.value;
                        setVariantModalState((prev) => ({
                          ...prev,
                          selectedCategory: newCat,
                          selectedIngredientId: '',
                        }));
                      }}
                      className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26] cursor-pointer"
                    >
                      <option value="ALL">📁 ทุกหมวดหมู่วัตถุดิบ</option>
                      {ingredientCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat === 'เนื้อสัตว์และอาหารทะเล' ? '🥩 ' : cat === 'ผักและสมุนไพร' ? '🥬 ' : cat === 'เครื่องปรุงและซอส' ? '🧂 ' : cat === 'ข้าวและเส้น' ? '🍚 ' : cat === 'ไข่และเต้าหู้' ? '🥚 ' : cat === 'บรรจุภัณฑ์' ? '🥡 ' : '📦 '}{cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* ขั้นที่ 2: เลือกวัตถุดิบย่อย */}
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      2. เลือกวัตถุดิบย่อย <span className="text-[#F27D26]">*</span>
                    </label>
                    <select
                      value={variantModalState.selectedIngredientId}
                      onChange={(e) => {
                        const ingId = e.target.value;
                        if (ingId === 'seafood_combo') {
                          setVariantModalState((prev) => ({
                            ...prev,
                            selectedIngredientId: 'seafood_combo',
                            seafoodShrimpQty: prev.seafoodShrimpQty || 4,
                            seafoodSquidQty: prev.seafoodSquidQty || 40,
                            variant: {
                              ...prev.variant,
                              proteinType: 'ทะเล',
                              name: prev.mode === 'ADD' || !prev.variant?.name ? `${prev.menu?.name} ทะเล` : prev.variant?.name,
                            },
                          }));
                        } else if (ingId) {
                          const ing = ingredients.find((i) => i.id === ingId);
                          if (ing) {
                            const pName = ing.name.split(' (')[0].split(' ')[0];
                            const defaultQty = ing.usageUnit === 'ตัว' || ing.baseUnit === 'ตัว' ? 4 : 80;
                            setVariantModalState((prev) => ({
                              ...prev,
                              selectedCategory: ing.category || prev.selectedCategory,
                              selectedIngredientId: ingId,
                              meatQuantity: defaultQty,
                              variant: {
                                ...prev.variant,
                                proteinType: pName,
                                name: prev.mode === 'ADD' || !prev.variant?.name ? `${prev.menu?.name} ${pName}` : prev.variant?.name,
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
                      <option value="">-- เลือกวัตถุดิบย่อย ({currentCategoryIngredients.length} รายการ) --</option>
                      {(variantModalState.selectedCategory === 'ALL' || variantModalState.selectedCategory === 'เนื้อสัตว์และอาหารทะเล') && (
                        <option value="seafood_combo" className="font-bold text-[#F27D26]">
                          🌊 ทะเล (กุ้งสด + ปลาหมึกสด คู่กัน)
                        </option>
                      )}
                      {currentCategoryIngredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Quick Selection Chips - Filtered dynamically by currentCategoryIngredients */}
                {currentCategoryIngredients.length > 0 && (
                  <div>
                    <div className="text-[10px] text-stone-500 font-semibold mb-1">ปุ่มลัดเลือกด่วนในหมวดนี้:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(variantModalState.selectedCategory === 'ALL' || variantModalState.selectedCategory === 'เนื้อสัตว์และอาหารทะเล') && (
                        <button
                          type="button"
                          onClick={() => {
                            setVariantModalState((prev) => ({
                              ...prev,
                              selectedIngredientId: 'seafood_combo',
                              seafoodShrimpQty: prev.seafoodShrimpQty || 4,
                              seafoodSquidQty: prev.seafoodSquidQty || 40,
                              variant: {
                                ...prev.variant,
                                proteinType: 'ทะเล',
                                name: prev.mode === 'ADD' || !prev.variant?.name ? `${prev.menu?.name} ทะเล` : prev.variant?.name,
                              },
                            }));
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer border ${
                            variantModalState.selectedIngredientId === 'seafood_combo' || variantModalState.variant?.proteinType === 'ทะเล'
                              ? 'bg-[#0284C7] text-white border-[#0369A1] shadow-2xs'
                              : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                          }`}
                        >
                          🌊 ทะเล (กุ้ง+หมึก)
                        </button>
                      )}
                      {currentCategoryIngredients.slice(0, 8).map((ing) => {
                        const isSelected = variantModalState.selectedIngredientId === ing.id;
                        const shortName = ing.name.split(' (')[0];
                        return (
                          <button
                            key={ing.id}
                            type="button"
                            onClick={() => {
                              const defaultQty = ing.usageUnit === 'ตัว' || ing.baseUnit === 'ตัว' ? 4 : 80;
                              setVariantModalState((prev) => ({
                                ...prev,
                                selectedIngredientId: ing.id,
                                meatQuantity: defaultQty,
                                variant: {
                                  ...prev.variant,
                                  proteinType: shortName,
                                  name: prev.mode === 'ADD' || !prev.variant?.name ? `${prev.menu?.name} ${shortName}` : prev.variant?.name,
                                },
                              }));
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer border ${
                              isSelected
                                ? 'bg-[#F27D26] text-white border-[#c2580e] shadow-2xs'
                                : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'
                            }`}
                          >
                            {shortName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. รายละเอียดตัวเลือก */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-800 mb-1 font-bold text-xs">
                    ประเภทเนื้อสัตว์ <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น หมูสับ, หมูหมัก, อกไก่, กุ้ง, ทะเล"
                    value={variantModalState.variant.proteinType || ''}
                    onChange={(e) =>
                      setVariantModalState((prev) => ({
                        ...prev,
                        variant: {
                          ...prev.variant,
                          proteinType: e.target.value,
                          name: prev.mode === 'ADD' && (!prev.variant?.name || prev.variant.name.startsWith(prev.menu?.name || ''))
                            ? `${prev.menu?.name} ${e.target.value}`
                            : prev.variant?.name,
                        },
                      }))
                    }
                    className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26]"
                  />
                </div>

                <div>
                  <label className="block text-stone-800 mb-1 font-bold text-xs">
                    ชื่อรายการตัวเลือก
                  </label>
                  <input
                    type="text"
                    placeholder="เช่น ข้าวกะเพรา หมูสับ"
                    value={variantModalState.variant.name || ''}
                    onChange={(e) =>
                      setVariantModalState((prev) => ({
                        ...prev,
                        variant: { ...prev.variant, name: e.target.value },
                      }))
                    }
                    className="w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-semibold focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26]"
                  />
                </div>
              </div>

              {/* 3. ปริมาณเนื้อสัตว์ที่ใช้ (รองรับทั้งเนื้อสัตว์เดี่ยว และ ทะเล กุ้ง+หมึก) */}
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
                          <span>🌊 สัดส่วนวัตถุดิบทะเล (กุ้งสด + ปลาหมึกสด ต้องมีทั้งคู่):</span>
                        </span>
                        <span className="text-[10px] text-sky-800 bg-sky-100 px-2 py-0.5 rounded-md font-bold border border-sky-300">
                          Seafood Rule (แยกชิ้น/กรัม)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-white p-2.5 rounded-xl border border-amber-300 shadow-2xs space-y-1">
                          <label className="block text-amber-950 font-bold text-xs">
                            🦐 กุ้งสด (XL):
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              required
                              value={variantModalState.seafoodShrimpQty ?? 4}
                              onChange={(e) =>
                                setVariantModalState((prev) => ({
                                  ...prev,
                                  seafoodShrimpQty: parseFloat(e.target.value) || 0,
                                }))
                              }
                              className="w-24 p-2 bg-amber-50/50 border border-amber-400 rounded-lg text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-amber-600"
                            />
                            <span className="text-xs text-stone-700 font-bold">ตัว</span>
                            <span className="text-[10px] text-stone-500 ml-auto">
                              (@ ฿8.50/ตัว)
                            </span>
                          </div>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-sky-300 shadow-2xs space-y-1">
                          <label className="block text-sky-950 font-bold text-xs">
                            🦑 ปลาหมึกกล้วยสด:
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              required
                              value={variantModalState.seafoodSquidQty ?? 40}
                              onChange={(e) =>
                                setVariantModalState((prev) => ({
                                  ...prev,
                                  seafoodSquidQty: parseFloat(e.target.value) || 0,
                                }))
                              }
                              className="w-24 p-2 bg-sky-50/50 border border-sky-400 rounded-lg text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-sky-600"
                            />
                            <span className="text-xs text-stone-700 font-bold">กรัม (g)</span>
                            <span className="text-[10px] text-stone-500 ml-auto">
                              (@ ฿0.388/g)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div>
                    <label className="block text-stone-800 mb-1 font-bold text-xs">
                      ปริมาณเนื้อสัตว์ที่ใช้ต่อจาน{' '}
                      <span className="text-stone-500 font-normal">
                        ({ingredients.find((i) => i.id === variantModalState.selectedIngredientId)?.usageUnit || 'กรัม หรือ ตัว'})
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={variantModalState.meatQuantity}
                        onChange={(e) =>
                          setVariantModalState((prev) => ({
                            ...prev,
                            meatQuantity: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-32 p-2.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26]"
                      />
                      <span className="text-xs text-stone-600 font-semibold">
                        {ingredients.find((i) => i.id === variantModalState.selectedIngredientId)?.usageUnit || 'กรัม (g)'}
                      </span>
                      {/* Quick preset weight buttons */}
                      <div className="flex items-center gap-1 ml-auto">
                        {[60, 70, 80, 100, 120].map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() =>
                              setVariantModalState((prev) => ({ ...prev, meatQuantity: w }))
                            }
                            className={`px-2 py-1 text-[10px] font-bold rounded-lg border ${
                              variantModalState.meatQuantity === w
                                ? 'bg-[#F27D26] text-white border-[#c2580e]'
                                : 'bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-200'
                            }`}
                          >
                            {w}g
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 4. ราคาขายแต่ละช่องทาง */}
              <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl space-y-3">
                <div className="font-black text-stone-900 text-xs">การตั้งราคาขายแต่ละช่องทาง (บาท)</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      ราคาหน้าร้าน (Dine-in) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={variantModalState.variant.sellingPrice || ''}
                      onChange={(e) => {
                        const price = parseFloat(e.target.value) || 0;
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: {
                            ...prev.variant,
                            sellingPrice: price,
                            takeawayPrice: prev.variant?.takeawayPrice || (price > 0 ? price + 5 : 0),
                            grabPrice: prev.variant?.grabPrice || Math.round(price * 1.5),
                            linemanPrice: prev.variant?.linemanPrice || Math.round(price * 1.5),
                            robinhoodPrice: prev.variant?.robinhoodPrice || price,
                          },
                        }));
                      }}
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      ราคาใส่กล่อง (Takeaway)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={variantModalState.variant.takeawayPrice || ''}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, takeawayPrice: parseFloat(e.target.value) || 0 },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      ราคา Grab Food
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={variantModalState.variant.grabPrice || ''}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, grabPrice: parseFloat(e.target.value) || 0 },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      ราคา Line Man
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={variantModalState.variant.linemanPrice || ''}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, linemanPrice: parseFloat(e.target.value) || 0 },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      ราคา Robinhood
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={variantModalState.variant.robinhoodPrice || ''}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, robinhoodPrice: parseFloat(e.target.value) || 0 },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      ค่ากล่อง/แพ็กเกจจิ้ง (บาท)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={variantModalState.variant.packagingCost ?? 9}
                      onChange={(e) =>
                        setVariantModalState((prev) => ({
                          ...prev,
                          variant: { ...prev.variant, packagingCost: parseFloat(e.target.value) || 0 },
                        }))
                      }
                      className="w-full p-2 bg-white border border-stone-300 rounded-xl text-stone-900 text-xs font-bold font-mono focus:outline-none focus:border-[#F27D26]"
                    />
                  </div>
                </div>
              </div>

              {/* POS Integration: Code / SKU, Out-of-Stock Status & Available Channels */}
              <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 text-xs flex items-center gap-1.5">
                    <span>📡 ข้อมูลเชื่อมต่อระบบ POS (POS Integration)</span>
                  </span>
                  <span className="text-[10px] text-stone-500 font-mono">
                    SKU & Channel Availability
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-700 mb-1 font-bold text-[11px]">
                      รหัสตัวเลือก / SKU (เชื่อม POS)
                    </label>
                    <input
                      type="text"
                      placeholder="เช่น KPR-PORK, MK01-1"
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
                      บาร์โค้ด (Barcode)
                    </label>
                    <input
                      type="text"
                      placeholder="เช่น 885001234567"
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
                      ⚠️ วัตถุดิบหมด / งดขายชั่วคราว (Out of Stock)
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
                      เปิดใช้งานในระบบ (Active)
                    </span>
                  </label>
                </div>

                {/* Channel selection */}
                <div className="pt-1 border-t border-stone-200">
                  <label className="block text-stone-700 mb-1.5 font-bold text-[11px]">
                    ช่องทางจำหน่ายที่เปิดขาย (Available Channels):
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'DINE_IN', label: 'หน้าร้าน (Dine-in)' },
                      { id: 'TAKEAWAY', label: 'ใส่กล่อง (Takeaway)' },
                      { id: 'GRAB', label: 'GrabFood' },
                      { id: 'LINEMAN', label: 'LINE MAN' },
                    ].map((ch) => {
                      const currentChannels = variantModalState.variant?.availableChannels || [
                        'DINE_IN',
                        'TAKEAWAY',
                        'GRAB',
                        'LINEMAN',
                      ];
                      const isChecked = currentChannels.includes(ch.id);
                      return (
                        <label
                          key={ch.id}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                            isChecked
                              ? 'bg-[#F27D26]/10 border-[#F27D26] text-[#B45309]'
                              : 'bg-white border-stone-200 text-stone-500'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const nextChannels = e.target.checked
                                ? [...currentChannels, ch.id]
                                : currentChannels.filter((c) => c !== ch.id);
                              setVariantModalState((prev) => ({
                                ...prev,
                                variant: {
                                  ...prev.variant,
                                  availableChannels: nextChannels,
                                },
                              }));
                            }}
                            className="sr-only"
                          />
                          <span>{ch.label}</span>
                        </label>
                      );
                    })}
                  </div>
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
                  const sCost = (shrimpIng?.costPerBaseUnit || 8.5) * (Number(variantModalState.seafoodShrimpQty) || 4);
                  const qCost = (squidIng?.costPerBaseUnit || 0.388) * (Number(variantModalState.seafoodSquidQty) || 40);
                  meatCost = Math.round(sCost + qCost);
                  costDetail = `กุ้ง ฿${Math.round(sCost)} + หมึก ฿${Math.round(qCost)}`;
                } else {
                  const linked = ingredients.find((i) => i.id === variantModalState.selectedIngredientId);
                  const unitCost = linked?.costPerBaseUnit || 0.125;
                  meatCost = Math.round(unitCost * (Number(variantModalState.meatQuantity) || 0));
                  if (linked) {
                    costDetail = `฿${(unitCost * 1000).toFixed(0)}/กก.`;
                  }
                }

                const sellPrice = Number(variantModalState.variant.sellingPrice) || 65;
                const estTotalCost = meatCost + 6.0 + 9.0;
                const estProfit = sellPrice - estTotalCost;
                const estFc = sellPrice > 0 ? Math.round((meatCost / sellPrice) * 100) : 0;

                return (
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs font-mono">
                    <div>
                      <span className="text-emerald-900 font-bold">ต้นทุนเนื้อสัตว์: </span>
                      <strong className="text-emerald-950 font-black">฿{meatCost}</strong>
                      {costDetail && (
                        <span className="text-[10px] text-emerald-700 ml-1">
                          ({costDetail})
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-stone-700 font-bold">กำไรหน้าร้าน: </span>
                      <strong className="text-emerald-800 font-black">฿{estProfit}</strong>
                      <span className="text-[10px] text-stone-600 ml-1.5 font-sans">
                        (FC ~{estFc}%)
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() =>
                    setVariantModalState({ isOpen: false, mode: 'ADD', menu: null, variant: null, selectedIngredientId: '', meatQuantity: 80 })
                  }
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-white font-bold rounded-xl shadow-lg shadow-[#F27D26]/20 cursor-pointer"
                >
                  {variantModalState.mode === 'ADD' ? 'บันทึกตัวเลือกใหม่' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE VARIANT CONFIRMATION MODAL */}
      {variantToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-[#FFFDF9] rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#EAE4D9] text-[#1C1917]">
            <div className="flex items-center justify-between border-b border-[#EAE4D9] pb-3">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Trash2 className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-bold text-[#1C1917] text-base">ยืนยันการลบตัวเลือกเนื้อสัตว์</h3>
                  <p className="text-xs text-stone-500 font-medium">เมนู: {variantToDelete.menu.name}</p>
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
            <div className="space-y-4 mt-4 text-xs">
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-xs">
                    ต้องการลบตัวเลือก "{variantToDelete.variant.name || variantToDelete.variant.proteinType}" ใช่หรือไม่?
                  </p>
                  <p className="text-[11px] text-rose-700 leading-relaxed">
                    ตัวเลือกเนื้อสัตว์นี้จะถูกลบออกจากตารางต้นทุนและการตั้งราคาของเมนู {variantToDelete.menu.name} ทันที
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#EAE4D9]">
                <button
                  type="button"
                  onClick={() => setVariantToDelete(null)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteVariant}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ยืนยันการลบตัวเลือก</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
