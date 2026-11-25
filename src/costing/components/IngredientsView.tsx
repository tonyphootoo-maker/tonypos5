import React, { useState, useRef } from 'react';
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  X,
  Sparkles,
  Scale,
  Percent,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  GripVertical,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import {
  Ingredient,
  IngredientCategory,
  UnitType,
  PriceHistoryRecord,
  Sauce,
  MenuVariant,
  RestaurantSettings,
} from '../types';
import {
  calculateIngredientCost,
  analyzePriceChangeImpact,
} from '../services/calculationEngine';
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
import { convertUnit } from '../engine/units';
import {
  DEFAULT_PURCHASE_UNITS,
  DEFAULT_USAGE_UNITS,
  loadCustomPurchaseUnits,
  saveCustomPurchaseUnits,
  syncUnitToPortionUnitsStorage,
  mergeUniqueUnits,
  getUnitOptionLabel,
} from '../utils/customUnits';

interface IngredientsViewProps {
  ingredients: Ingredient[];
  sauces: Sauce[];
  variants: MenuVariant[];
  menuNamesMap: Map<string, string>;
  settings: RestaurantSettings;
  priceHistory: PriceHistoryRecord[];
  lang?: 'th' | 'en';
  onSaveIngredient: (ingredient: Ingredient) => void;
  onDeleteIngredient?: (id: string) => void;
  onReorderIngredients?: (reordered: Ingredient[]) => void;
  onRecordPriceChange: (record: PriceHistoryRecord) => void;
  onSaveSettings?: (settings: RestaurantSettings) => void;
}

export const IngredientsView: React.FC<IngredientsViewProps> = ({
  ingredients,
  sauces,
  variants,
  menuNamesMap,
  settings,
  priceHistory,
  lang: propLang,
  onSaveIngredient,
  onDeleteIngredient,
  onReorderIngredients,
  onRecordPriceChange,
  onSaveSettings,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const defaultCategories = [
    'เนื้อสัตว์และอาหารทะเล',
    'ผักและสมุนไพร',
    'เครื่องปรุงและซอส',
    'ข้าวและเส้น',
    'ไข่และเต้าหู้',
    'ของแห้งและเบ็ดเตล็ด',
    'บรรจุภัณฑ์',
  ];

  // Custom, Hidden-Default & Category order states with localStorage persistence
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryEnglishName, setNewCategoryEnglishName] = useState('');
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cost_custom_ingredient_categories');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [hiddenDefaultCategories, setHiddenDefaultCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cost_hidden_ingredient_categories');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Edit / Delete Category modal state
  const [isEditCategoryModalOpen, setIsEditCategoryModalOpen] = useState(false);
  const [editingCategoryOldName, setEditingCategoryOldName] = useState('');
  const [editingCategoryNewName, setEditingCategoryNewName] = useState('');
  const [editCategoryEnglishName, setEditCategoryEnglishName] = useState('');
  const [editCategoryError, setEditCategoryError] = useState<string | null>(null);
  const [isDeleteCategoryModalOpen, setIsDeleteCategoryModalOpen] = useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = useState('');

  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cost_ingredient_category_order');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const rawCategories = Array.from(
    new Set([
      ...defaultCategories.filter((c) => !hiddenDefaultCategories.includes(c)),
      ...customCategories,
      ...ingredients.map((i) => i.category).filter(Boolean),
    ])
  );

  // Sorted categories based on saved categoryOrder
  const allCategories = React.useMemo(() => {
    if (categoryOrder.length === 0) return rawCategories;
    const orderMap = new Map<string, number>();
    categoryOrder.forEach((cat, idx) => orderMap.set(cat, idx));

    return [...rawCategories].sort((a, b) => {
      const posA = orderMap.has(a) ? orderMap.get(a)! : 9999;
      const posB = orderMap.has(b) ? orderMap.get(b)! : 9999;
      if (posA !== posB) return posA - posB;
      return a.localeCompare(b, 'th');
    });
  }, [rawCategories, categoryOrder]);

  const [selectedCategory, setSelectedCategory] = useState<string>(
    () => allCategories[0] || 'เนื้อสัตว์และอาหารทะเล'
  );

  const categoryTabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasMountedCategoryRef = useRef(false);

  const scrollCategoryTabIntoCenter = (catName: string) => {
    const el = categoryTabRefs.current.get(catName);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  React.useEffect(() => {
    if (allCategories.length > 0 && !allCategories.includes(selectedCategory)) {
      setSelectedCategory(allCategories[0]);
    }
  }, [allCategories, selectedCategory]);

  React.useEffect(() => {
    if (!hasMountedCategoryRef.current) {
      hasMountedCategoryRef.current = true;
      return;
    }
    if (!selectedCategory) return;
    const rafId = requestAnimationFrame(() => {
      scrollCategoryTabIntoCenter(selectedCategory);
    });
    return () => cancelAnimationFrame(rafId);
  }, [selectedCategory]);

  const handleSelectCategory = (catName: string) => {
    if (selectedCategory === catName) {
      scrollCategoryTabIntoCenter(catName);
      return;
    }
    setSelectedCategory(catName);
  };

  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Partial<Ingredient> | null>(null);
  const [sortOrder, setSortOrder] = useState<'default' | 'asc' | 'desc'>('default');

  // Custom Purchase Units state (persisted in localStorage + RestaurantSettings + existing ingredients)
  const [customPurchaseUnits, setCustomPurchaseUnits] = useState<string[]>(() =>
    mergeUniqueUnits(loadCustomPurchaseUnits(), settings.customPurchaseUnits)
  );
  const [isAddingPurchaseUnit, setIsAddingPurchaseUnit] = useState(false);
  const [newPurchaseUnitInput, setNewPurchaseUnitInput] = useState('');

  React.useEffect(() => {
    if (settings.customPurchaseUnits && settings.customPurchaseUnits.length > 0) {
      setCustomPurchaseUnits((prev) => {
        const merged = mergeUniqueUnits(prev, settings.customPurchaseUnits);
        if (merged.length !== prev.length) {
          saveCustomPurchaseUnits(merged);
          return merged;
        }
        return prev;
      });
    }
  }, [settings.customPurchaseUnits]);

  const purchaseUnitOptions = React.useMemo(
    () =>
      mergeUniqueUnits(
        DEFAULT_PURCHASE_UNITS,
        customPurchaseUnits,
        settings.customPurchaseUnits,
        ingredients.map((i) => i.purchaseUnit),
        editingIngredient?.purchaseUnit ? [editingIngredient.purchaseUnit] : []
      ),
    [customPurchaseUnits, settings.customPurchaseUnits, ingredients, editingIngredient?.purchaseUnit]
  );

  const usageUnitOptions = React.useMemo(
    () =>
      mergeUniqueUnits(
        DEFAULT_USAGE_UNITS,
        customPurchaseUnits,
        settings.customPurchaseUnits,
        ingredients.map((i) => i.usageUnit),
        editingIngredient?.purchaseUnit ? [editingIngredient.purchaseUnit] : [],
        editingIngredient?.usageUnit ? [editingIngredient.usageUnit] : []
      ),
    [
      customPurchaseUnits,
      settings.customPurchaseUnits,
      ingredients,
      editingIngredient?.purchaseUnit,
      editingIngredient?.usageUnit,
    ]
  );

  const handleAddCustomPurchaseUnit = () => {
    const trimmed = newPurchaseUnitInput.trim();
    if (!trimmed) return;
    const nextCustom = mergeUniqueUnits(customPurchaseUnits, [trimmed]);
    setCustomPurchaseUnits(nextCustom);
    saveCustomPurchaseUnits(nextCustom);
    syncUnitToPortionUnitsStorage(trimmed);
    if (onSaveSettings) {
      onSaveSettings({
        ...settings,
        customPurchaseUnits: mergeUniqueUnits(settings.customPurchaseUnits, nextCustom),
      });
    }
    if (editingIngredient) {
      const currentUsage = editingIngredient.usageUnit || 'g';
      const compatible = convertUnit(1, trimmed, currentUsage).success;
      const hasSubUnitPieces = Number(editingIngredient.piecesPerPurchaseUnit) > 0;
      setEditingIngredient({
        ...editingIngredient,
        purchaseUnit: trimmed as UnitType,
        actualUnit: trimmed as UnitType,
        baseUnit: trimmed as UnitType,
        ...(!compatible && !hasSubUnitPieces ? { usageUnit: trimmed as UnitType } : {}),
      });
    }
    setNewPurchaseUnitInput('');
    setIsAddingPurchaseUnit(false);
  };

  const handleDeleteCustomPurchaseUnit = (unitToDelete: string) => {
    if (DEFAULT_PURCHASE_UNITS.includes(unitToDelete)) return;
    const nextCustom = customPurchaseUnits.filter((u) => u !== unitToDelete);
    setCustomPurchaseUnits(nextCustom);
    saveCustomPurchaseUnits(nextCustom);
    if (onSaveSettings) {
      onSaveSettings({
        ...settings,
        customPurchaseUnits: (settings.customPurchaseUnits || []).filter((u) => u !== unitToDelete),
      });
    }
    if (editingIngredient && editingIngredient.purchaseUnit === unitToDelete) {
      setEditingIngredient({
        ...editingIngredient,
        purchaseUnit: 'g',
        actualUnit: 'g',
        baseUnit: 'g',
        usageUnit: 'g',
      });
    }
  };

  // Price Simulation Modal state
  const [isImpactModalOpen, setIsImpactModalOpen] = useState(false);
  const [simulatingIngredient, setSimulatingIngredient] = useState<Ingredient | null>(null);
  const [simulatedNewPrice, setSimulatedNewPrice] = useState<number>(0);
  const [priceChangeReason, setPriceChangeReason] = useState<string>('');

  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);

  const handleMoveCategory = (catName: string, direction: 'left' | 'right') => {
    const currentIndex = allCategories.indexOf(catName);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= allCategories.length) return;

    const newOrder = [...allCategories];
    const [moved] = newOrder.splice(currentIndex, 1);
    newOrder.splice(targetIndex, 0, moved);

    setCategoryOrder(newOrder);
    try {
      localStorage.setItem('cost_ingredient_category_order', JSON.stringify(newOrder));
    } catch (err) {
      console.error('Failed to save category order', err);
    }
  };

  const handleCategoryDragStart = (e: React.DragEvent, catName: string) => {
    setDraggedCategory(catName);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', catName);
    } catch {}
  };

  const handleCategoryDragOver = (e: React.DragEvent, catName: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverCategory !== catName) {
      setDragOverCategory(catName);
    }
  };

  const handleCategoryDrop = (e: React.DragEvent, targetCatName: string) => {
    e.preventDefault();
    const sourceCat = draggedCategory || e.dataTransfer.getData('text/plain');
    setDraggedCategory(null);
    setDragOverCategory(null);

    if (!sourceCat) return;

    const fromIndex = allCategories.indexOf(sourceCat);
    if (fromIndex === -1) return;

    const newOrder = [...allCategories];
    const [moved] = newOrder.splice(fromIndex, 1);

    const toIndex = newOrder.indexOf(targetCatName);
    if (toIndex === -1) {
      newOrder.push(moved);
    } else {
      newOrder.splice(toIndex, 0, moved);
    }

    setCategoryOrder(newOrder);
    try {
      localStorage.setItem('cost_ingredient_category_order', JSON.stringify(newOrder));
    } catch (err) {
      console.error('Failed to save category order', err);
    }
  };

  const handleCategoryDragEnd = () => {
    setDraggedCategory(null);
    setDragOverCategory(null);
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    if (hiddenDefaultCategories.includes(trimmed)) {
      const nextHidden = hiddenDefaultCategories.filter((c) => c !== trimmed);
      setHiddenDefaultCategories(nextHidden);
      try {
        localStorage.setItem('cost_hidden_ingredient_categories', JSON.stringify(nextHidden));
      } catch {}
    }
    if (!allCategories.includes(trimmed)) {
      const updated = Array.from(new Set([...customCategories, trimmed]));
      setCustomCategories(updated);
      try {
        localStorage.setItem('cost_custom_ingredient_categories', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save category', err);
      }
      const updatedOrder = [...allCategories, trimmed];
      setCategoryOrder(updatedOrder);
      try {
        localStorage.setItem('cost_ingredient_category_order', JSON.stringify(updatedOrder));
      } catch (err) {
        console.error('Failed to save category order', err);
      }
    }
    if (trimmed && newCategoryEnglishName.trim()) {
      learnShopTranslation(trimmed, newCategoryEnglishName.trim(), { isManual: true });
    }
    setSelectedCategory(trimmed);
    setNewCategoryName('');
    setNewCategoryEnglishName('');
    setIsAddCategoryModalOpen(false);
  };

  const handleOpenEditCategory = (catName: string) => {
    setEditingCategoryOldName(catName);
    setEditingCategoryNewName(catName);
    setEditCategoryEnglishName(translateThaiToEnglish(catName));
    setEditCategoryError(null);
    setIsEditCategoryModalOpen(true);
  };

  const handleSaveEditCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = editingCategoryNewName.trim();
    if (!trimmed) {
      setEditCategoryError(lang === 'th' ? 'กรุณากรอกชื่อหมวดหมู่' : 'Please enter a category name');
      return;
    }
    if (trimmed !== editingCategoryOldName && allCategories.includes(trimmed)) {
      setEditCategoryError(lang === 'th' ? 'มีหมวดหมู่นี้อยู่ในระบบแล้ว' : 'This category already exists');
      return;
    }

    if (trimmed !== editingCategoryOldName) {
      const now = new Date().toISOString();
      ingredients.forEach((ing) => {
        if (ing.category === editingCategoryOldName) {
          onSaveIngredient({
            ...ing,
            category: trimmed as IngredientCategory,
            updatedAt: now,
          });
        }
      });

      if (hiddenDefaultCategories.includes(trimmed)) {
        const nextHidden = hiddenDefaultCategories.filter((c) => c !== trimmed);
        setHiddenDefaultCategories(nextHidden);
        try {
          localStorage.setItem('cost_hidden_ingredient_categories', JSON.stringify(nextHidden));
        } catch {}
      }

      if (defaultCategories.includes(editingCategoryOldName)) {
        const nextHidden = Array.from(new Set([...hiddenDefaultCategories, editingCategoryOldName]));
        setHiddenDefaultCategories(nextHidden);
        try {
          localStorage.setItem('cost_hidden_ingredient_categories', JSON.stringify(nextHidden));
        } catch {}
      }

      const updatedCustom = customCategories.some((c) => c === editingCategoryOldName)
        ? customCategories.map((c) => (c === editingCategoryOldName ? trimmed : c))
        : defaultCategories.includes(trimmed) && !hiddenDefaultCategories.includes(trimmed)
        ? customCategories
        : [...customCategories, trimmed];
      const uniqueCustom = Array.from(new Set(updatedCustom));
      setCustomCategories(uniqueCustom);
      try {
        localStorage.setItem('cost_custom_ingredient_categories', JSON.stringify(uniqueCustom));
      } catch (err) {
        console.error('Failed to update custom categories', err);
      }

      const baseOrder = categoryOrder.length > 0 ? categoryOrder : allCategories;
      const updatedOrder = Array.from(
        new Set(baseOrder.map((c) => (c === editingCategoryOldName ? trimmed : c)))
      );
      if (!updatedOrder.includes(trimmed)) updatedOrder.push(trimmed);
      setCategoryOrder(updatedOrder);
      try {
        localStorage.setItem('cost_ingredient_category_order', JSON.stringify(updatedOrder));
      } catch {}

      if (selectedCategory === editingCategoryOldName) {
        setSelectedCategory(trimmed);
      }
    }

    if (trimmed && editCategoryEnglishName.trim()) {
      learnShopTranslation(trimmed, editCategoryEnglishName.trim(), { isManual: true });
    }

    setIsEditCategoryModalOpen(false);
    setEditCategoryError(null);
  };

  const handleOpenDeleteCategory = (catName: string) => {
    setDeletingCategoryName(catName);
    setIsDeleteCategoryModalOpen(true);
  };

  const handleConfirmDeleteCategory = () => {
    if (!deletingCategoryName) return;
    const remaining = allCategories.filter((c) => c !== deletingCategoryName);
    const fallbackCategory = remaining[0] || 'อื่นๆ';
    const now = new Date().toISOString();

    ingredients.forEach((ing) => {
      if (ing.category === deletingCategoryName) {
        onSaveIngredient({
          ...ing,
          category: fallbackCategory as IngredientCategory,
          updatedAt: now,
        });
      }
    });

    if (defaultCategories.includes(deletingCategoryName)) {
      const nextHidden = Array.from(new Set([...hiddenDefaultCategories, deletingCategoryName]));
      setHiddenDefaultCategories(nextHidden);
      try {
        localStorage.setItem('cost_hidden_ingredient_categories', JSON.stringify(nextHidden));
      } catch {}
    }

    const updatedCustom = customCategories.filter((c) => c !== deletingCategoryName);
    setCustomCategories(updatedCustom);
    try {
      localStorage.setItem('cost_custom_ingredient_categories', JSON.stringify(updatedCustom));
    } catch {}

    const updatedOrder = categoryOrder.filter((c) => c !== deletingCategoryName);
    setCategoryOrder(updatedOrder);
    try {
      localStorage.setItem('cost_ingredient_category_order', JSON.stringify(updatedOrder));
    } catch {}

    if (selectedCategory === deletingCategoryName) {
      setSelectedCategory(fallbackCategory);
    }
    setIsDeleteCategoryModalOpen(false);
    setDeletingCategoryName('');
  };

  // Filtered ingredients
  const filteredIngredients = ingredients.filter((ing) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      ing.name.toLowerCase().includes(q) ||
      (ing.englishName && ing.englishName.toLowerCase().includes(q)) ||
      getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName).toLowerCase().includes(q) ||
      (ing.notes && ing.notes.toLowerCase().includes(q));
    const matchesCategory = !selectedCategory || ing.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Sorted ingredients (Ascending / Descending by display name)
  const displayedIngredients = React.useMemo(() => {
    if (sortOrder === 'default') {
      return filteredIngredients;
    }
    return [...filteredIngredients].sort((a, b) => {
      const nameA = getLocalizedText(lang, a.thaiName || a.name, a.englishName);
      const nameB = getLocalizedText(lang, b.thaiName || b.name, b.englishName);
      const cmp = nameA.localeCompare(nameB, lang === 'en' ? 'en' : 'th', { sensitivity: 'base', numeric: true });
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [filteredIngredients, sortOrder, lang]);

  // Drag & drop and reorder state
  const [draggedIngredientId, setDraggedIngredientId] = useState<string | null>(null);
  const [dragOverIngredientId, setDragOverIngredientId] = useState<string | null>(null);

  const handleMoveIngredient = (fromId: string, direction: 'up' | 'down') => {
    if (sortOrder !== 'default') {
      setSortOrder('default');
    }
    const visIndex = displayedIngredients.findIndex((i) => i.id === fromId);
    if (visIndex === -1) return;
    const targetVisIndex = direction === 'up' ? visIndex - 1 : visIndex + 1;
    if (targetVisIndex < 0 || targetVisIndex >= displayedIngredients.length) return;
    const targetId = displayedIngredients[targetVisIndex].id;

    const fromIndex = ingredients.findIndex((i) => i.id === fromId);
    const toIndex = ingredients.findIndex((i) => i.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const updated = [...ingredients];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onReorderIngredients?.(updated);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedIngredientId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {}
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIngredientId !== id) {
      setDragOverIngredientId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggedIngredientId || e.dataTransfer.getData('text/plain');
    setDraggedIngredientId(null);
    setDragOverIngredientId(null);

    if (!sourceId || sourceId === targetId) return;
    if (sortOrder !== 'default') {
      setSortOrder('default');
    }
    const fromIndex = ingredients.findIndex((i) => i.id === sourceId);
    const toIndex = ingredients.findIndex((i) => i.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const updated = [...ingredients];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onReorderIngredients?.(updated);
  };

  const prevIngThaiRef = useRef<string>('');
  const translationScheduler = useDebouncedTranslationScheduler(600);

  const handleDragEnd = () => {
    setDraggedIngredientId(null);
    setDragOverIngredientId(null);
  };

  const handleOpenAdd = () => {
    translationScheduler.cancelAll();
    prevIngThaiRef.current = '';
    const defaultCat = (selectedCategory || allCategories[0] || 'เนื้อสัตว์และอาหารทะเล') as IngredientCategory;

    const newIng: Partial<Ingredient> = {
      id: `ing_${Date.now()}`,
      name: '',
      thaiName: '',
      englishName: '',
      englishNameManual: false,
      category: defaultCat,
      purchaseQuantity: 1000,
      purchaseUnit: 'g',
      purchasePrice: 100,
      actualQuantity: 1000,
      actualUnit: 'g',
      yieldPercent: 100,
      actualCost: 100,
      baseUnit: 'g',
      costPerBaseUnit: 0.1,
      usageUnit: 'g',
      active: true,
      createdAt: new Date().toISOString(),
    };
    setIsAddingPurchaseUnit(false);
    setNewPurchaseUnitInput('');
    setEditingIngredient(newIng);
    setIsEditingModalOpen(true);
  };

  const handleOpenEdit = (ing: Ingredient) => {
    translationScheduler.cancelAll();
    const pQty = Number(ing.purchaseQuantity) || 1000;
    const yPct = Number(ing.yieldPercent) || 100;
    const computedActual = ing.actualQuantity !== undefined && ing.actualQuantity !== null
      ? ing.actualQuantity
      : Number(((pQty * yPct) / 100).toFixed(1));
    const thName = ing.thaiName || ing.name || '';
    prevIngThaiRef.current = thName;
    const storedEn = (ing.englishName || '').trim();
    const resolvedInitialEn =
      ing.englishNameManual && storedEn && !containsThaiCharacters(storedEn)
        ? storedEn
        : storedEn && !containsThaiCharacters(storedEn)
        ? storedEn
        : translateThaiToEnglish(thName);

    setIsAddingPurchaseUnit(false);
    setNewPurchaseUnitInput('');
    setEditingIngredient({
      ...ing,
      thaiName: thName,
      englishName: resolvedInitialEn,
      englishNameManual: Boolean(ing.englishNameManual),
      actualQuantity: computedActual,
      actualUnit: ing.actualUnit || ing.purchaseUnit || 'g',
    });
    setIsEditingModalOpen(true);
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIngredient || !editingIngredient.name) return;
    translationScheduler.cancelAll();

    const trimmedTh = editingIngredient.name.trim();
    const isManual = Boolean(editingIngredient.englishNameManual);
    const trimmedEn = isManual
      ? (editingIngredient.englishName || '').trim()
      : computeAutoEnglishName({
          previousThai: prevIngThaiRef.current || trimmedTh,
          nextThai: trimmedTh,
          currentEnglish: editingIngredient.englishName || '',
          isManuallyEdited: false,
        }).trim() || translateThaiToEnglish(trimmedTh);

    const calc = calculateIngredientCost(editingIngredient);
    const completeIngredient: Ingredient = {
      id: editingIngredient.id || `ing_${Date.now()}`,
      name: trimmedTh,
      thaiName: trimmedTh,
      englishName: trimmedEn,
      englishNameManual: isManual,
      category: editingIngredient.category || 'เนื้อสัตว์และอาหารทะเล',
      purchaseQuantity: Number(editingIngredient.purchaseQuantity) || 1,
      purchaseUnit: editingIngredient.purchaseUnit || 'g',
      purchasePrice: Number(editingIngredient.purchasePrice) || 0,
      actualQuantity: Number(editingIngredient.actualQuantity) || Number(editingIngredient.purchaseQuantity) || 1,
      actualUnit: editingIngredient.actualUnit || editingIngredient.purchaseUnit || 'g',
      yieldPercent: Number(editingIngredient.yieldPercent) || 100,
      actualCost: calc.actualCost,
      baseUnit:
        editingIngredient.usageUnit ||
        editingIngredient.baseUnit ||
        editingIngredient.actualUnit ||
        editingIngredient.purchaseUnit ||
        'g',
      costPerBaseUnit: calc.costPerBaseUnit,
      usageUnit: editingIngredient.usageUnit || 'g',
      piecesPerPurchaseUnit: editingIngredient.piecesPerPurchaseUnit,
      piecesCountAlreadyYieldAdjusted: editingIngredient.piecesCountAlreadyYieldAdjusted,
      notes: editingIngredient.notes,
      isReviewRequired: editingIngredient.isReviewRequired || false,
      reviewReason: editingIngredient.reviewReason,
      displayOrder: editingIngredient.displayOrder,
      active: editingIngredient.active !== undefined ? editingIngredient.active : true,
      createdAt: editingIngredient.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveIngredient(completeIngredient);
    if (trimmedTh && trimmedEn) {
      learnShopTranslation(trimmedTh, trimmedEn, { isManual });
    }
    setIsEditingModalOpen(false);
    setEditingIngredient(null);
  };

  const handleOpenSimulate = (ing: Ingredient) => {
    setSimulatingIngredient(ing);
    setSimulatedNewPrice(ing.purchasePrice);
    setPriceChangeReason('');
    setIsImpactModalOpen(true);
  };

  const handleApplySimulatedPrice = () => {
    if (!simulatingIngredient) return;

    const oldPrice = simulatingIngredient.purchasePrice;
    const newPrice = simulatedNewPrice;

    // Recalculate ingredient with new price
    const calc = calculateIngredientCost({
      ...simulatingIngredient,
      purchasePrice: newPrice,
    });

    const updatedIng: Ingredient = {
      ...simulatingIngredient,
      purchasePrice: newPrice,
      actualCost: calc.actualCost,
      costPerBaseUnit: calc.costPerBaseUnit,
      updatedAt: new Date().toISOString(),
    };

    // Record price history
    const historyRecord: PriceHistoryRecord = {
      id: `hist_${Date.now()}`,
      ingredientId: simulatingIngredient.id,
      ingredientName: simulatingIngredient.name,
      oldPrice,
      newPrice,
      oldCostPerUnit: simulatingIngredient.costPerBaseUnit,
      newCostPerUnit: calc.costPerBaseUnit,
      unit: simulatingIngredient.usageUnit,
      date: new Date().toISOString().slice(0, 10),
      reason: priceChangeReason || (lang === 'th' ? 'ปรับราคาจากโปรแกรมจำลองผลกระทบ' : 'Price adjusted from Impact Simulator'),
      user: `${settings.userRole}`,
    };

    onRecordPriceChange(historyRecord);
    onSaveIngredient(updatedIng);
    setIsImpactModalOpen(false);
  };

  // Run impact analysis for simulation modal
  const impactAnalysis = simulatingIngredient
    ? analyzePriceChangeImpact(
        simulatingIngredient.id,
        simulatedNewPrice,
        simulatingIngredient.yieldPercent,
        ingredients,
        sauces,
        variants,
        menuNamesMap,
        settings
      )
    : null;

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] min-h-[500px] w-full min-w-0 max-w-full overflow-hidden -mb-8">
      {/* LOCKED TOP SECTION */}
      <div className="shrink-0 z-20 space-y-3 pb-3 bg-stone-900/40 backdrop-blur-md pt-1 min-w-0 max-w-full">
        {/* Title & Actions */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 shadow-sm min-w-0 max-w-full">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight min-w-0">
            {lang === 'th' ? 'ฐานข้อมูลวัตถุดิบและต้นทุน Yield' : 'Ingredients & Yield Database'}
          </h1>

          <div className="flex items-center gap-2 flex-wrap shrink-0 max-w-full">
            <button
              type="button"
              onClick={() => setIsAddCategoryModalOpen(true)}
              className="px-3.5 py-2 bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#F27D26]" />
              <span>{lang === 'th' ? '+ เพิ่มหมวดหมู่' : '+ Add Category'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenAdd}
              className="px-4 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === 'th' ? '+ เพิ่มวัตถุดิบใหม่' : '+ Add Ingredient'}</span>
            </button>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-2.5 sm:p-3 rounded-2xl flex items-center gap-2.5 min-w-0 max-w-full shadow-sm">
        {/* Compact Search: Magnifying glass icon only to save screen space */}
        <div className="flex items-center gap-2 shrink-0">
          {isSearchExpanded ? (
            <div className="relative flex items-center w-56 sm:w-64 transition-all">
              <Search className="w-4 h-4 absolute left-3 text-white/40 pointer-events-none" />
              <input
                type="text"
                autoFocus
                placeholder={lang === 'th' ? 'ค้นหาวัตถุดิบ...' : 'Search ingredients...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 bg-black/40 border border-[#F27D26]/60 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-[#F27D26]"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setIsSearchExpanded(false);
                }}
                className="absolute right-2.5 text-white/40 hover:text-white p-0.5 cursor-pointer"
                title={lang === 'th' ? 'ปิดค้นหา' : 'Close search'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsSearchExpanded(true)}
              className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${
                searchTerm
                  ? 'bg-[#F27D26]/20 border-[#F27D26] text-[#F27D26]'
                  : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white'
              }`}
              title={lang === 'th' ? 'ค้นหาวัตถุดิบ' : 'Search ingredients'}
            >
              <Search className="w-4 h-4" />
              {searchTerm && (
                <span className="ml-1.5 text-[11px] font-medium max-w-[90px] truncate text-white">
                  {searchTerm}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto scrollbar-none py-0.5">
          <Filter className="w-4 h-4 text-white/40 shrink-0 hidden sm:block mr-0.5" />

          {/* Reorderable Categories */}
          {allCategories.map((cat, index) => {
            const isSelected = selectedCategory === cat;
            const isDragged = draggedCategory === cat;
            const isDragOver = dragOverCategory === cat;
            const isFirst = index === 0;
            const isLast = index === allCategories.length - 1;
            const catLabel = getLocalizedText(lang, cat);
            const controlsVisibilityClass = isSelected
              ? 'inline-flex'
              : 'hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:inline-flex';

            return (
              <div
                key={cat}
                ref={(el) => {
                  if (el) {
                    categoryTabRefs.current.set(cat, el);
                  } else {
                    categoryTabRefs.current.delete(cat);
                  }
                }}
                draggable
                onDragStart={(e) => handleCategoryDragStart(e, cat)}
                onDragOver={(e) => handleCategoryDragOver(e, cat)}
                onDrop={(e) => handleCategoryDrop(e, cat)}
                onDragEnd={handleCategoryDragEnd}
                className={`group relative inline-flex flex-none items-center rounded-xl text-xs font-semibold whitespace-nowrap transition-all select-none ${
                  isSelected
                    ? 'bg-[#F27D26] text-black font-bold shadow-md shadow-[#F27D26]/20'
                    : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10'
                } ${isDragged ? 'opacity-40 scale-95 ring-2 ring-[#F27D26]' : ''} ${
                  isDragOver ? 'ring-2 ring-[#F27D26] bg-[#F27D26]/20 border-[#F27D26]' : ''
                }`}
                title={lang === 'th' ? 'คลิกเลือก | กดค้างแล้วลากวาง หรือใช้ปุ่มลูกศร ซ้าย-ขวา เพื่อย้ายตำแหน่ง' : 'Click to filter | Drag or use arrows to reorder'}
              >
                {/* Move Left Button */}
                <button
                  type="button"
                  disabled={isFirst}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveCategory(cat, 'left');
                  }}
                  className={`${controlsVisibilityClass} items-center justify-center p-1 pl-1.5 transition-all rounded-l-xl ${
                    isFirst
                      ? 'opacity-20 cursor-not-allowed'
                      : isSelected
                      ? 'hover:bg-black/15 text-black/70 hover:text-black cursor-pointer'
                      : 'text-white/40 hover:text-white hover:bg-white/10 cursor-pointer'
                  }`}
                  title={lang === 'th' ? `ย้ายหมวดหมู่ "${catLabel}" ไปทางซ้าย` : `Move "${catLabel}" left`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                {/* Category Label with Drag Grip */}
                <div
                  onClick={() => handleSelectCategory(cat)}
                  className={`flex items-center gap-1.5 py-1.5 cursor-pointer ${
                    isSelected
                      ? 'px-1 cursor-grab active:cursor-grabbing'
                      : 'px-3 [@media(hover:hover)_and_(pointer:fine)]:group-hover:px-1 [@media(hover:hover)_and_(pointer:fine)]:group-hover:cursor-grab'
                  }`}
                >
                  <GripVertical
                    className={`${controlsVisibilityClass} w-3 h-3 shrink-0 ${
                      isSelected
                        ? 'text-black/50 group-hover:text-black'
                        : 'text-white/30 group-hover:text-white/70'
                    }`}
                  />
                  <span>{catLabel}</span>
                </div>

                {/* Edit Category Name Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEditCategory(cat);
                  }}
                  className={`${controlsVisibilityClass} items-center justify-center p-1 transition-all cursor-pointer ${
                    isSelected
                      ? 'hover:bg-black/15 text-black/70 hover:text-black'
                      : 'text-white/40 hover:text-[#F27D26] hover:bg-white/10'
                  }`}
                  title={lang === 'th' ? `แก้ไขชื่อหมวดหมู่ "${catLabel}"` : `Edit "${catLabel}"`}
                >
                  <Edit2 className="w-3 h-3" />
                </button>

                {/* Delete Category Button */}
                {allCategories.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenDeleteCategory(cat);
                    }}
                    className={`${controlsVisibilityClass} items-center justify-center p-1 transition-all cursor-pointer ${
                      isSelected
                        ? 'hover:bg-black/15 text-black/70 hover:text-rose-900'
                        : 'text-white/35 hover:text-rose-400 hover:bg-white/10'
                    }`}
                    title={lang === 'th' ? `ลบหมวดหมู่ "${catLabel}"` : `Delete "${catLabel}"`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}

                {/* Move Right Button */}
                <button
                  type="button"
                  disabled={isLast}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveCategory(cat, 'right');
                  }}
                  className={`${controlsVisibilityClass} items-center justify-center p-1 pr-1.5 transition-all rounded-r-xl ${
                    isLast
                      ? 'opacity-20 cursor-not-allowed'
                      : isSelected
                      ? 'hover:bg-black/15 text-black/70 hover:text-black cursor-pointer'
                      : 'text-white/40 hover:text-white hover:bg-white/10 cursor-pointer'
                  }`}
                  title={lang === 'th' ? `ย้ายหมวดหมู่ "${catLabel}" ไปทางขวา` : `Move "${catLabel}" right`}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {/* INGREDIENTS TABLE (Scrollable area) */}
      <div className="flex-1 min-h-0 min-w-0 w-full max-w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-xl flex flex-col mb-4">
        <div className="flex-1 w-full max-w-full overflow-x-auto overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-[#161618] border-b border-white/15 shadow-sm">
              <tr className="text-white/70 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-3 w-12 text-center">{lang === 'th' ? 'ลำดับ' : 'Order'}</th>
                <th className="py-3 px-4 select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSortOrder((prev) => (prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default'));
                      }}
                      className="flex items-center gap-1 font-bold uppercase tracking-wider text-[10px] text-white/70 hover:text-white transition-colors cursor-pointer group"
                      title={lang === 'th' ? 'คลิกเพื่อสลับ: ลำดับปกติ -> น้อยไปมาก (ก-ฮ) -> มากไปน้อย (ฮ-ก)' : 'Toggle sort order'}
                    >
                      <span>{lang === 'th' ? 'วัตถุดิบ' : 'Ingredient'}</span>
                      {sortOrder === 'asc' ? (
                        <ArrowUp className="w-2.5 h-2.5 text-[#F27D26]" />
                      ) : sortOrder === 'desc' ? (
                        <ArrowDown className="w-2.5 h-2.5 text-[#F27D26]" />
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-white/40 group-hover:text-white" />
                      )}
                    </button>

                    <div className="inline-flex items-center bg-black/40 p-0.5 rounded border border-white/10 gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSortOrder((prev) => (prev === 'asc' ? 'default' : 'asc'));
                        }}
                        className={`h-4.5 px-1.5 rounded text-[9px] font-medium flex items-center gap-0.5 transition-all cursor-pointer ${
                          sortOrder === 'asc'
                            ? 'bg-[#F27D26] text-black font-bold shadow-xs'
                            : 'text-white/60 hover:text-white hover:bg-white/10'
                        }`}
                        title={lang === 'th' ? 'เรียงลำดับจากน้อยไปมาก (ก-ฮ)' : 'Sort A-Z'}
                      >
                        <ArrowUp className="w-2.5 h-2.5" />
                        <span>{lang === 'th' ? 'ก-ฮ' : 'A-Z'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSortOrder((prev) => (prev === 'desc' ? 'default' : 'desc'));
                        }}
                        className={`h-4.5 px-1.5 rounded text-[9px] font-medium flex items-center gap-0.5 transition-all cursor-pointer ${
                          sortOrder === 'desc'
                            ? 'bg-[#F27D26] text-black font-bold shadow-xs'
                            : 'text-white/60 hover:text-white hover:bg-white/10'
                        }`}
                        title={lang === 'th' ? 'เรียงลำดับจากมากไปน้อย (ฮ-ก)' : 'Sort Z-A'}
                      >
                        <ArrowDown className="w-2.5 h-2.5" />
                        <span>{lang === 'th' ? 'ฮ-ก' : 'Z-A'}</span>
                      </button>
                    </div>
                  </div>
                </th>
                <th className="py-3 px-3">{lang === 'th' ? 'ปริมาณที่ซื้อ' : 'Purchase Qty'}</th>
                <th className="py-3 px-3">{lang === 'th' ? 'ราคาซื้อ' : 'Purchase Price'}</th>
                <th className="py-3 px-3">Yield (%)</th>
                <th className="py-3 px-3">{lang === 'th' ? 'น้ำหนักสุทธิ' : 'Net Yield Qty'}</th>
                <th className="py-3 px-3">{lang === 'th' ? 'ต้นทุนจริงหลัง Yield' : 'Yield Cost'}</th>
                <th className="py-3 px-3">{lang === 'th' ? 'ต้นทุนต่อหน่วยใช้งาน' : 'Cost / Usage Unit'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayedIngredients.map((ing, visIndex) => {
                const isShrimp = ing.usageUnit === 'ตัว';
                const isDragged = draggedIngredientId === ing.id;
                const isDragOver = dragOverIngredientId === ing.id;
                const isFirst = visIndex <= 0;
                const isLast = visIndex >= displayedIngredients.length - 1;
                const primaryName = getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName);
                const secondaryName =
                  lang === 'en'
                    ? ing.thaiName || ing.name
                    : (ing.englishName || translateThaiToEnglish(ing.name) || '').trim();

                return (
                  <tr
                    key={ing.id}
                    onDragOver={(e) => handleDragOver(e, ing.id)}
                    onDrop={(e) => handleDrop(e, ing.id)}
                    className={`transition-colors ${
                      isDragged
                        ? 'opacity-40 bg-white/5'
                        : isDragOver
                        ? 'bg-[#F27D26]/20 border-t-2 border-[#F27D26]'
                        : ing.isReviewRequired
                        ? 'bg-red-500/10 hover:bg-red-500/15'
                        : 'hover:bg-white/10'
                    }`}
                  >
                    {/* Reorder drag handle & up/down arrow buttons */}
                    <td className="py-3.5 px-2 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, ing.id)}
                          onDragEnd={handleDragEnd}
                          className="p-1 text-white/40 hover:text-[#F27D26] cursor-grab active:cursor-grabbing hover:bg-white/10 rounded transition-colors"
                          title={lang === 'th' ? 'กดค้างแล้วลากเพื่อย้ายตำแหน่ง' : 'Drag to reorder'}
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col -space-y-1">
                          <button
                            type="button"
                            onClick={() => handleMoveIngredient(ing.id, 'up')}
                            disabled={isFirst}
                            className={`p-0.5 rounded transition-colors ${
                              isFirst
                                ? 'text-white/15 cursor-not-allowed'
                                : 'text-white/50 hover:text-white hover:bg-white/10 cursor-pointer'
                            }`}
                            title={lang === 'th' ? 'ย้ายขึ้น' : 'Move up'}
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveIngredient(ing.id, 'down')}
                            disabled={isLast}
                            className={`p-0.5 rounded transition-colors ${
                              isLast
                                ? 'text-white/15 cursor-not-allowed'
                                : 'text-white/50 hover:text-white hover:bg-white/10 cursor-pointer'
                            }`}
                            title={lang === 'th' ? 'ย้ายลง' : 'Move down'}
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </td>

                    <td
                      className="py-3.5 px-4 font-semibold text-white cursor-pointer select-none"
                      onDoubleClick={() => handleOpenEdit(ing)}
                      title={lang === 'th' ? 'ดับเบิลคลิกเพื่อแก้ไขข้อมูลวัตถุดิบ' : 'Double-click to edit ingredient'}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="hover:text-[#F27D26] hover:underline transition-colors">
                          {primaryName}
                        </span>
                        {lang === 'th' && secondaryName && secondaryName !== primaryName && (
                          <span className="text-[10px] font-normal text-white/50">
                            ({secondaryName})
                          </span>
                        )}
                        <div className="inline-flex items-center gap-0.5 ml-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(ing);
                            }}
                            className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                            title={lang === 'th' ? 'แก้ไขวัตถุดิบ' : 'Edit ingredient'}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteIngredient?.(ing.id);
                            }}
                            className="p-1 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors cursor-pointer"
                            title={lang === 'th' ? 'ลบวัตถุดิบ' : 'Delete ingredient'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {(!ing.purchasePrice || ing.purchasePrice <= 0) && (
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            title={lang === 'th' ? 'ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง' : 'Purchase price missing — cost may be understated'}
                          >
                            {lang === 'th' ? 'ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง' : 'Missing Purchase Price'}
                          </span>
                        )}
                        {ing.isReviewRequired && (!ing.purchasePrice || ing.purchasePrice > 0) && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30"
                            title={ing.reviewReason}
                          >
                            {lang === 'th' ? 'รอตรวจทาน' : 'Review Required'}
                          </span>
                        )}
                        {!ing.active && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white/40">
                            {lang === 'th' ? 'ระงับ' : 'Inactive'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-white/70 font-mono">
                      {ing.purchaseQuantity.toLocaleString()} {localizeUnit(ing.purchaseUnit, lang)}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-white font-bold">
                      ฿{ing.purchasePrice.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full font-bold font-mono text-[11px] ${
                          ing.yieldPercent >= 100
                            ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                            : ing.yieldPercent >= 75
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {ing.yieldPercent}%
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-white/70 font-mono">
                      {ing.actualQuantity} {localizeUnit(ing.actualUnit, lang)}
                    </td>
                    <td className="py-3.5 px-3 font-mono font-semibold text-white/80">
                      ฿{ing.actualCost.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-mono font-bold text-[#FFC107] text-xs">
                        ฿{ing.costPerBaseUnit.toFixed(4)} / {localizeUnit(ing.usageUnit, lang)}
                      </div>
                      {isShrimp && ing.piecesPerPurchaseUnit && (
                        <div className="text-[10px] text-white/40 font-normal">
                          ({ing.piecesPerPurchaseUnit} {lang === 'th' ? 'ตัว/กล่อง' : 'pcs/box'})
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {displayedIngredients.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-white/40 text-xs">
                    {lang === 'th' ? 'ไม่พบรายการวัตถุดิบ' : 'No ingredients found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* EDIT / ADD INGREDIENT MODAL */}
      {isEditingModalOpen && editingIngredient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="modal-panel-fixed bg-[#1a1a1a] rounded-3xl max-w-xl w-full shadow-2xl border border-white/20 text-white">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h2 className="text-lg font-bold text-white">
                {editingIngredient.id
                  ? lang === 'th' ? 'แก้ไขข้อมูลวัตถุดิบ' : 'Edit Ingredient'
                  : lang === 'th' ? 'เพิ่มวัตถุดิบใหม่' : 'Add New Ingredient'}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditingModalOpen(false)}
                className="p-1 text-white/50 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
              {/* Name & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-white/80 mb-1">
                    {lang === 'th' ? 'ชื่อวัตถุดิบ (ไทย)' : 'Ingredient Name (Thai)'}{' '}
                    <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editingIngredient.name || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditingIngredient((prev) =>
                        prev ? { ...prev, name: nextTh, thaiName: nextTh } : prev
                      );
                      translationScheduler.schedule('ingredient', () => {
                        setEditingIngredient((prev) => {
                          if (!prev) return prev;
                          const currTh = prev.name || '';
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevIngThaiRef.current,
                            nextThai: currTh,
                            currentEnglish: prev.englishName,
                            isManuallyEdited: Boolean(prev.englishNameManual),
                          });
                          prevIngThaiRef.current = currTh;
                          return { ...prev, englishName: nextEn };
                        });
                      });
                    }}
                    onBlur={() => translationScheduler.flush('ingredient')}
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none"
                    placeholder={lang === 'th' ? 'เช่น หมูหมัก, กุ้งสด XL' : 'e.g. Marinated Pork, Fresh Shrimp XL'}
                  />
                </div>

                <div>
                  <label className="block font-bold text-white/80 mb-1">
                    {lang === 'th' ? 'หมวดหมู่' : 'Category'}
                  </label>
                  <select
                    value={editingIngredient.category || 'เนื้อสัตว์และอาหารทะเล'}
                    onChange={(e) =>
                      setEditingIngredient({
                        ...editingIngredient,
                        category: e.target.value as IngredientCategory,
                      })
                    }
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none cursor-pointer"
                  >
                    {allCategories
                      .filter((c) => c !== 'ALL')
                      .map((cat) => (
                        <option key={cat} value={cat} className="bg-[#1a1a1a] text-white">
                          {getLocalizedText(lang, cat)}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <label className="block font-bold text-white/80">
                      {lang === 'th'
                        ? 'ชื่อวัตถุดิบภาษาอังกฤษ (English Name — แปลอัตโนมัติ)'
                        : 'English Name (Auto-translated)'}
                    </label>
                    {needsEnglishReview(editingIngredient.name, editingIngredient.englishName) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-400">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      translationScheduler.cancel('ingredient');
                      prevIngThaiRef.current = editingIngredient.name || '';
                      setEditingIngredient({
                        ...editingIngredient,
                        englishName: translateThaiToEnglish(editingIngredient.name || ''),
                        englishNameManual: false,
                      });
                    }}
                    className="text-[11px] font-bold text-[#F27D26] hover:underline cursor-pointer"
                  >
                    {lang === 'th' ? 'แปลใหม่จากภาษาไทย' : 'Re-translate from Thai'}
                  </button>
                </div>
                <input
                  type="text"
                  value={editingIngredient.englishName || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    translationScheduler.cancel('ingredient');
                    setEditingIngredient({
                      ...editingIngredient,
                      englishName: val,
                      englishNameManual: Boolean(val.trim()),
                    });
                  }}
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-amber-200 font-medium focus:border-[#F27D26] focus:outline-none placeholder-white/30"
                  placeholder={lang === 'th' ? 'ชื่อภาษาอังกฤษที่แปลอัตโนมัติ (แก้ไขได้)' : 'Auto-translated English name (editable)'}
                />
              </div>

              {/* Purchase Details */}
              <div className="p-3.5 bg-white/5 rounded-2xl border border-white/10 space-y-3">
                <div className="font-bold text-[#F27D26] text-xs uppercase tracking-wider">
                  {lang === 'th' ? 'ข้อมูลการซื้อ (Purchase Specs)' : 'Purchase Specs'}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-white/60 mb-1">
                      {lang === 'th' ? 'ปริมาณที่ซื้อ' : 'Purchase Qty'}
                    </label>
                    <NumericInput
                      type="number"
                      step="any"
                      required
                      value={editingIngredient.purchaseQuantity ?? ''}
                      onChange={(e) => {
                        const newPQty = parseFloat(e.target.value) || 0;
                        const currentActual = editingIngredient.actualQuantity;
                        const newYield =
                          newPQty > 0 && currentActual !== undefined && currentActual > 0
                            ? Number(((currentActual / newPQty) * 100).toFixed(1))
                            : (editingIngredient.yieldPercent ?? 100);
                        setEditingIngredient({
                          ...editingIngredient,
                          purchaseQuantity: newPQty,
                          yieldPercent: newYield,
                        });
                      }}
                      className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono text-white"
                      placeholder={lang === 'th' ? 'เช่น 1000' : 'e.g. 1000'}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <label className="block text-white/60">
                        {lang === 'th' ? 'หน่วยซื้อ' : 'Purchase Unit'}
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsAddingPurchaseUnit((prev) => !prev)}
                        className="text-[10px] font-bold text-[#F27D26] hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{lang === 'th' ? 'เพิ่มหน่วย' : 'Add Unit'}</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <select
                        value={editingIngredient.purchaseUnit || 'g'}
                        onChange={(e) => {
                          const newUnit = e.target.value as UnitType;
                          const currentUsage = editingIngredient.usageUnit || 'g';
                          const compatible = convertUnit(1, newUnit, currentUsage).success;
                          const hasSubUnitPieces = Number(editingIngredient.piecesPerPurchaseUnit) > 0;
                          setEditingIngredient({
                            ...editingIngredient,
                            purchaseUnit: newUnit,
                            actualUnit: newUnit,
                            baseUnit: newUnit,
                            ...(!compatible && !hasSubUnitPieces ? { usageUnit: newUnit } : {}),
                          });
                        }}
                        className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white cursor-pointer"
                      >
                        {purchaseUnitOptions.map((u) => (
                          <option key={u} value={u} className="bg-[#1a1a1a] text-white">
                            {getUnitOptionLabel(u, lang)}
                          </option>
                        ))}
                      </select>
                      {editingIngredient.purchaseUnit &&
                        customPurchaseUnits.includes(editingIngredient.purchaseUnit) &&
                        !DEFAULT_PURCHASE_UNITS.includes(editingIngredient.purchaseUnit) && (
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteCustomPurchaseUnit(editingIngredient.purchaseUnit!)
                            }
                            className="p-2 rounded-xl border border-white/15 text-white/40 hover:text-rose-400 hover:bg-rose-500/15 cursor-pointer shrink-0"
                            title={
                              lang === 'th'
                                ? `ลบหน่วยซื้อ "${editingIngredient.purchaseUnit}"`
                                : `Delete unit "${editingIngredient.purchaseUnit}"`
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">
                      {lang === 'th' ? 'ราคาซื้อ (บาท)' : 'Purchase Price (THB)'}
                    </label>
                    <NumericInput
                      type="number"
                      step="any"
                      required
                      value={editingIngredient.purchasePrice ?? ''}
                      onChange={(e) =>
                        setEditingIngredient({
                          ...editingIngredient,
                          purchasePrice: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-[#FFC107]"
                    />
                  </div>
                </div>

                {/* Inline Add Custom Purchase Unit Input */}
                {isAddingPurchaseUnit && (
                  <div className="flex flex-wrap items-center gap-2 p-2.5 bg-black/40 border border-[#F27D26]/40 rounded-xl">
                    <input
                      type="text"
                      autoFocus
                      value={newPurchaseUnitInput}
                      onChange={(e) => setNewPurchaseUnitInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomPurchaseUnit();
                        }
                      }}
                      placeholder={
                        lang === 'th'
                          ? 'พิมพ์ชื่อหน่วยซื้อใหม่ เช่น ลัง, แกลลอน, กระสอบ, มัด...'
                          : 'New purchase unit e.g. crate, gallon, sack...'
                      }
                      className="flex-1 min-w-[160px] p-2 bg-black/50 border border-white/15 rounded-xl text-white text-xs focus:border-[#F27D26] focus:outline-none placeholder-white/30"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomPurchaseUnit}
                      className="px-3 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-[11px] cursor-pointer"
                    >
                      {lang === 'th' ? 'เพิ่มหน่วยซื้อ' : 'Add Unit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingPurchaseUnit(false);
                        setNewPurchaseUnitInput('');
                      }}
                      className="px-2.5 py-2 bg-white/10 hover:bg-white/20 text-white/80 font-semibold rounded-xl text-[11px] cursor-pointer"
                    >
                      {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                    </button>
                  </div>
                )}

                {/* Row 2: Actual Quantity after trimming */}
                <div className="grid grid-cols-3 gap-3 pt-2.5 border-t border-white/10">
                  <div>
                    <label className="block text-emerald-400 font-bold mb-1">
                      {lang === 'th' ? 'ปริมาณที่ได้จริง(หลังตัดแต่ง)' : 'Usable Qty (After Trim)'}
                    </label>
                    <NumericInput
                      type="number"
                      step="any"
                      required
                      value={editingIngredient.actualQuantity ?? ''}
                      onChange={(e) => {
                        const newActual = parseFloat(e.target.value) || 0;
                        const pQty = Number(editingIngredient.purchaseQuantity) || 0;
                        const newYield = pQty > 0 ? Number(((newActual / pQty) * 100).toFixed(1)) : 100;
                        setEditingIngredient({
                          ...editingIngredient,
                          actualQuantity: newActual,
                          yieldPercent: newYield,
                        });
                      }}
                      className="w-full p-2 bg-black/40 border border-emerald-500/40 focus:border-emerald-400 rounded-xl font-mono font-bold text-emerald-300"
                      placeholder={lang === 'th' ? 'เช่น 950' : 'e.g. 950'}
                    />
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">
                      {lang === 'th' ? 'หน่วยที่ได้จริง' : 'Actual Unit'}
                    </label>
                    <div className="w-full p-2 bg-black/20 border border-white/10 rounded-xl text-white/80 font-mono text-sm flex items-center justify-between">
                      <span>{localizeUnit(editingIngredient.actualUnit || editingIngredient.purchaseUnit || 'g', lang)}</span>
                      <span className="text-[10px] text-white/40">{lang === 'th' ? 'พร้อมปรุง' : 'Ready to cook'}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">
                      {lang === 'th' ? 'Yield (%) คำนวณอัตโนมัติ' : 'Auto-Calculated Yield (%)'}
                    </label>
                    <div className="w-full p-2 bg-black/40 border border-emerald-500/30 rounded-xl font-mono flex items-center justify-between">
                      <span className="font-bold text-emerald-400 text-sm">
                        {editingIngredient.yieldPercent ?? 100}%
                      </span>
                      {editingIngredient.purchaseQuantity && editingIngredient.actualQuantity !== undefined && (
                        <span className="text-[10px] text-rose-300">
                          {Number(editingIngredient.purchaseQuantity) > Number(editingIngredient.actualQuantity)
                            ? `${lang === 'th' ? 'สูญเสีย' : 'Loss'} -${(Number(editingIngredient.purchaseQuantity) - Number(editingIngredient.actualQuantity)).toFixed(1)} ${localizeUnit(editingIngredient.purchaseUnit || 'g', lang)}`
                            : 'Yield 100%'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Yield & Preparation Specs */}
              <div className="p-3.5 bg-white/5 rounded-2xl border border-white/10 space-y-3">
                <div className="font-bold text-[#FFC107] text-xs uppercase tracking-wider">
                  {lang === 'th' ? 'การเตรียมและ Yield (Preparation & Yield %)' : 'Preparation & Yield %'}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/60 mb-1">
                      {lang === 'th' ? 'Yield (%) หลังตัดแต่ง' : 'Yield (%) After Prep'}
                    </label>
                    <NumericInput
                      type="number"
                      step="any"
                      min="1"
                      max="200"
                      value={editingIngredient.yieldPercent ?? 100}
                      onChange={(e) => {
                        const newYield = parseFloat(e.target.value) || 100;
                        const pQty = Number(editingIngredient.purchaseQuantity) || 0;
                        const newActual = pQty > 0 ? Number(((pQty * newYield) / 100).toFixed(1)) : (editingIngredient.actualQuantity || 0);
                        setEditingIngredient({
                          ...editingIngredient,
                          yieldPercent: newYield,
                          actualQuantity: newActual,
                        });
                      }}
                      className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">
                      {lang === 'th' ? 'หน่วยใช้งานในสูตร' : 'Recipe Usage Unit'}
                    </label>
                    <select
                      value={editingIngredient.usageUnit || 'g'}
                      onChange={(e) =>
                        setEditingIngredient({
                          ...editingIngredient,
                          usageUnit: e.target.value as UnitType,
                        })
                      }
                      className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white cursor-pointer"
                    >
                      {usageUnitOptions.map((u) => (
                        <option key={u} value={u} className="bg-[#1a1a1a] text-white">
                          {getUnitOptionLabel(u, lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Sub-unit piece conversion when Purchase Unit differs from Usage Unit (e.g. 1 ลัง = 24 ขวด, 1 แผง = 30 ฟอง) */}
                {(() => {
                  const pUnit = editingIngredient.purchaseUnit || 'g';
                  const uUnit = editingIngredient.usageUnit || 'g';
                  const needsPieceConversion = !convertUnit(1, pUnit, uUnit).success;
                  const hasPieces = Number(editingIngredient.piecesPerPurchaseUnit) > 0;
                  if (!needsPieceConversion && !hasPieces) return null;

                  return (
                    <div className="pt-2.5 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                      <div>
                        <label className="block text-amber-300 font-bold mb-1">
                          {lang === 'th'
                            ? `จำนวน (${localizeUnit(uUnit, lang)}) ต่อ 1 ${localizeUnit(pUnit, lang)}`
                            : `Qty (${localizeUnit(uUnit, lang)}) per 1 ${localizeUnit(pUnit, lang)}`}
                        </label>
                        <NumericInput
                          type="number"
                          step="any"
                          min="0"
                          value={editingIngredient.piecesPerPurchaseUnit ?? ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setEditingIngredient({
                              ...editingIngredient,
                              piecesPerPurchaseUnit: Number.isFinite(val) && val > 0 ? val : undefined,
                            });
                          }}
                          className="w-full p-2 bg-black/40 border border-amber-500/40 rounded-xl font-mono font-bold text-amber-200 focus:border-[#F27D26]"
                          placeholder={lang === 'th' ? 'เช่น 24, 30, 60' : 'e.g. 24, 30, 60'}
                        />
                      </div>
                      <label className="flex items-center gap-2 p-2 bg-black/30 rounded-xl border border-white/10 cursor-pointer text-[11px] text-white/80">
                        <input
                          type="checkbox"
                          checked={Boolean(editingIngredient.piecesCountAlreadyYieldAdjusted)}
                          onChange={(e) =>
                            setEditingIngredient({
                              ...editingIngredient,
                              piecesCountAlreadyYieldAdjusted: e.target.checked,
                            })
                          }
                          className="w-4 h-4 accent-[#F27D26] cursor-pointer"
                        />
                        <span>
                          {lang === 'th'
                            ? 'จำนวนหน่วยย่อยที่กรอกเป็นจำนวนสุทธิหลังตัดแต่งแล้ว'
                            : 'Sub-unit count already accounts for trim yield'}
                        </span>
                      </label>
                    </div>
                  );
                })()}
              </div>

              {/* Calculated preview */}
              {(() => {
                const previewCalc = calculateIngredientCost(editingIngredient);
                return (
                  <div className="space-y-2">
                    <div className="p-3 bg-black/40 border border-white/10 rounded-2xl flex items-center justify-between font-mono">
                      <div>
                        <div className="text-[10px] text-white/40">
                          {lang === 'th' ? 'ต้นทุนจริงหลังหัก Yield' : 'Actual Cost (After Yield)'}
                        </div>
                        <div className="font-bold text-sm text-white">฿{previewCalc.actualCost.toFixed(2)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-[#F27D26]">
                          {lang === 'th'
                            ? `ต้นทุนต่อหน่วยใช้งาน (${localizeUnit(editingIngredient.usageUnit, lang)})`
                            : `Cost / Usage Unit (${localizeUnit(editingIngredient.usageUnit, lang)})`}
                        </div>
                        <div className="font-bold text-base text-[#FFC107]">
                          ฿{previewCalc.costPerBaseUnit.toFixed(6)}
                        </div>
                      </div>
                    </div>
                    {!previewCalc.isValid && previewCalc.errorMessage && (
                      <div className="p-2 bg-rose-500/15 border border-rose-500/30 rounded-xl text-[11px] text-rose-300 font-semibold">
                        {getLocalizedText(lang, previewCalc.errorMessage)}
                      </div>
                    )}
                  </div>
                );
              })()}

              </div>

              {/* Buttons */}
              <div className="modal-footer bg-[#1a1a1a] flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsEditingModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors cursor-pointer"
                >
                  {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold transition-colors cursor-pointer"
                >
                  {lang === 'th' ? 'บันทึกข้อมูล' : 'Save Ingredient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRICE CHANGE IMPACT SIMULATION MODAL */}
      {isImpactModalOpen && simulatingIngredient && impactAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="modal-panel bg-[#1a1a1a] rounded-3xl max-w-2xl w-full shadow-2xl border border-white/20 text-white">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#F27D26] uppercase">
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {lang === 'th'
                      ? 'โปรแกรมจำลองผลกระทบการปรับราคา (Impact Engine)'
                      : 'Price Change Impact Simulator'}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white mt-1">
                  {getLocalizedText(lang, simulatingIngredient.thaiName || simulatingIngredient.name, simulatingIngredient.englishName)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsImpactModalOpen(false)}
                className="p-1 text-white/50 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4 text-xs">
              {/* Price inputs */}
              <div className="grid grid-cols-2 gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                <div>
                  <span className="text-white/50 font-medium">
                    {lang === 'th' ? 'ราคาซื้อเดิม:' : 'Previous Price:'}
                  </span>
                  <div className="text-base font-bold text-white font-mono mt-0.5">
                    ฿{simulatingIngredient.purchasePrice.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-white/50">
                    (฿{simulatingIngredient.costPerBaseUnit.toFixed(4)} / {localizeUnit(simulatingIngredient.usageUnit, lang)})
                  </div>
                </div>

                <div>
                  <span className="text-[#F27D26] font-bold">
                    {lang === 'th' ? 'ราคาซื้อใหม่ที่จำลอง:' : 'Simulated New Price:'}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-bold text-white/70">฿</span>
                    <NumericInput
                      type="number"
                      step="0.5"
                      value={simulatedNewPrice}
                      onChange={(e) => setSimulatedNewPrice(parseFloat(e.target.value) || 0)}
                      className="w-full p-2 bg-black/40 border-2 border-[#F27D26] rounded-xl font-mono text-base font-bold text-[#F27D26] focus:outline-none"
                    />
                  </div>
                  <div className="text-[11px] text-[#FFC107] font-semibold mt-0.5">
                    (฿{impactAnalysis.newCostPerBaseUnit.toFixed(4)} / {localizeUnit(simulatingIngredient.usageUnit, lang)})
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-white/80 mb-1">
                  {lang === 'th' ? 'เหตุผลในการปรับราคา:' : 'Reason for Price Adjustment:'}
                </label>
                <input
                  type="text"
                  value={priceChangeReason}
                  onChange={(e) => setPriceChangeReason(e.target.value)}
                  className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none"
                  placeholder={lang === 'th' ? 'เช่น ราคาหน้าฟาร์มขยับขึ้น, น้ำมันแพง...' : 'e.g. Supplier price increase...'}
                />
              </div>

              {/* Affected Sauces */}
              {impactAnalysis.affectedSauces.length > 0 && (
                <div className="p-3.5 bg-[#FFC107]/10 border border-[#FFC107]/20 rounded-2xl space-y-2">
                  <div className="font-bold text-[#FFC107] text-[11px] uppercase">
                    {lang === 'th'
                      ? `ซอสที่ได้รับผลกระทบ (${impactAnalysis.affectedSauces.length} รายการ)`
                      : `Affected Sauces (${impactAnalysis.affectedSauces.length})`}
                  </div>
                  <div className="space-y-1.5">
                    {impactAnalysis.affectedSauces.map((s) => (
                      <div
                        key={s.sauceId}
                        className="flex items-center justify-between bg-black/30 p-2.5 rounded-xl border border-white/5 font-mono text-xs"
                      >
                        <span className="font-bold text-white">{getLocalizedText(lang, s.sauceName)}</span>
                        <div className="text-right">
                          <span className="text-white/50">฿{s.oldCostPerGram.toFixed(4)}</span>
                          <span className="mx-1.5 text-white/40">→</span>
                          <span className="font-bold text-[#FFC107]">฿{s.newCostPerGram.toFixed(4)}/g</span>
                          <span className="ml-1 text-[10px] text-red-400">
                            (+{s.percentChange.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Affected Menu Variants */}
              <div className="space-y-2">
                <div className="font-bold text-white text-sm">
                  {lang === 'th'
                    ? `เมนูที่ได้รับผลกระทบ (Affected Menus) (${impactAnalysis.affectedVariants.length} เมนู)`
                    : `Affected Menus (${impactAnalysis.affectedVariants.length})`}
                </div>
                {impactAnalysis.affectedVariants.length === 0 ? (
                  <div className="p-4 text-center text-white/50 bg-white/5 rounded-xl">
                    {lang === 'th' ? 'ไม่มีเมนูใดในระบบที่ใช้หรืออิงวัตถุดิบชิ้นนี้' : 'No menu items use this ingredient'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {impactAnalysis.affectedVariants.map((v) => (
                      <div
                        key={v.variantId}
                        className="p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-sm">
                            {getLocalizedText(lang, v.menuName)} - {getLocalizedText(lang, v.variantName)}
                          </span>
                          <span className="font-mono font-bold text-white/80">
                            {lang === 'th' ? 'ราคาขาย' : 'Price'} ฿{v.sellingPrice}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1 border-t border-white/10">
                          <div>
                            <span className="text-white/50">{lang === 'th' ? 'ต้นทุนรวมใหม่:' : 'New Total Cost:'}</span>
                            <div className="font-bold text-[#FFC107]">
                              ฿{v.newTotalCost.toFixed(2)}{' '}
                              <span className="text-[10px] text-red-400">
                                (+฿{v.costDiff.toFixed(2)})
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-white/50">{lang === 'th' ? 'กำไรสุทธิใหม่:' : 'New Net Profit:'}</span>
                            <div className="font-bold text-green-400">
                              ฿{v.newProfit.toFixed(2)}{' '}
                              <span className="text-[10px] text-red-400">
                                ({v.profitDiff < 0 ? '' : '+'}฿{v.profitDiff.toFixed(2)})
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-white/50">{lang === 'th' ? 'ราคาแนะนำใหม่:' : 'Suggested Price:'}</span>
                            <div className="font-bold text-blue-400">
                              ฿{v.newSuggestedPrice.toFixed(0)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Action Buttons */}
            <div className="modal-footer bg-[#1a1a1a] flex items-center justify-between border-t border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setIsImpactModalOpen(false)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors cursor-pointer"
              >
                {lang === 'th' ? 'ปิดหน้าต่าง' : 'Close'}
              </button>

              <button
                type="button"
                onClick={handleApplySimulatedPrice}
                className="px-5 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold shadow-md shadow-[#F27D26]/20 transition-colors cursor-pointer"
              >
                {lang === 'th'
                  ? `อนุมัติและปรับใช้ราคาใหม่นี้ (฿${simulatedNewPrice})`
                  : `Approve & Apply New Price (฿${simulatedNewPrice})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD CATEGORY MODAL */}
      {isAddCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="modal-panel bg-[#1a1a1a] rounded-2xl max-w-md w-full shadow-2xl border border-white/20 text-white animate-in fade-in zoom-in-95 duration-150">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#F27D26]" />
                <span>{lang === 'th' ? 'เพิ่มหมวดหมู่วัตถุดิบใหม่' : 'Add New Ingredient Category'}</span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsAddCategoryModalOpen(false);
                  setNewCategoryName('');
                }}
                className="p-1 text-white/50 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCategory} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
              <div>
                <label className="block font-bold text-white/80 mb-1.5">
                  {lang === 'th' ? 'ชื่อหมวดหมู่ใหม่ (ไทย)' : 'New Category Name (Thai)'}{' '}
                  <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={newCategoryName}
                  onChange={(e) => {
                    const nextTh = e.target.value;
                    setNewCategoryEnglishName((currEn) =>
                      computeAutoEnglishName({
                        previousThai: newCategoryName,
                        nextThai: nextTh,
                        currentEnglish: currEn,
                      })
                    );
                    setNewCategoryName(nextTh);
                  }}
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none placeholder-white/30"
                  placeholder={lang === 'th' ? 'เช่น เครื่องดื่ม, ของหวาน, เบเกอรี่, อาหารแปรรูป' : 'e.g. Beverages, Desserts, Bakery'}
                />
              </div>

              <div>
                <label className="block font-bold text-white/80 mb-1.5">
                  {lang === 'th' ? 'ชื่อภาษาอังกฤษ (แปลอัตโนมัติ)' : 'English Name (Auto-translated)'}
                </label>
                <input
                  type="text"
                  value={newCategoryEnglishName}
                  onChange={(e) => setNewCategoryEnglishName(e.target.value)}
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-amber-200 font-medium focus:border-[#F27D26] focus:outline-none placeholder-white/30"
                  placeholder={lang === 'th' ? 'ชื่อหมวดหมู่ภาษาอังกฤษที่แปลอัตโนมัติ' : 'Auto-translated category name'}
                />
              </div>

              </div>

              <div className="modal-footer bg-[#1a1a1a] flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddCategoryModalOpen(false);
                    setNewCategoryName('');
                    setNewCategoryEnglishName('');
                  }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors cursor-pointer"
                >
                  {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl shadow-md shadow-[#F27D26]/20 transition-all cursor-pointer"
                >
                  {lang === 'th' ? 'บันทึกหมวดหมู่' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CATEGORY MODAL */}
      {isEditCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="modal-panel bg-[#1a1a1a] rounded-2xl max-w-md w-full shadow-2xl border border-white/20 text-white animate-in fade-in zoom-in-95 duration-150">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-[#F27D26]" />
                <span>{lang === 'th' ? 'แก้ไขชื่อหมวดหมู่วัตถุดิบ' : 'Edit Ingredient Category'}</span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsEditCategoryModalOpen(false);
                  setEditCategoryError(null);
                }}
                className="p-1 text-white/50 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditCategory} className="flex flex-col flex-1 min-h-0 text-xs">
              <div className="modal-body space-y-4">
                <div>
                  <label className="block font-bold text-white/80 mb-1.5">
                    {lang === 'th' ? 'ชื่อหมวดหมู่ (ไทย)' : 'Category Name (Thai)'}{' '}
                    <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    autoFocus
                    required
                    value={editingCategoryNewName}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditCategoryEnglishName((currEn) =>
                        computeAutoEnglishName({
                          previousThai: editingCategoryNewName,
                          nextThai: nextTh,
                          currentEnglish: currEn,
                        })
                      );
                      setEditingCategoryNewName(nextTh);
                      if (editCategoryError) setEditCategoryError(null);
                    }}
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none"
                  />
                  {editCategoryError && (
                    <p className="text-[11px] text-rose-400 mt-1 font-semibold">{editCategoryError}</p>
                  )}
                </div>

                <div>
                  <label className="block font-bold text-white/80 mb-1.5">
                    {lang === 'th' ? 'ชื่อภาษาอังกฤษ (แปลอัตโนมัติ)' : 'English Name (Auto-translated)'}
                  </label>
                  <input
                    type="text"
                    value={editCategoryEnglishName}
                    onChange={(e) => setEditCategoryEnglishName(e.target.value)}
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-amber-200 font-medium focus:border-[#F27D26] focus:outline-none"
                  />
                </div>

                <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-[11px] text-white/70 leading-relaxed">
                  {lang === 'th'
                    ? `วัตถุดิบในหมวดหมู่ "${editingCategoryOldName}" (${ingredients.filter((i) => i.category === editingCategoryOldName).length} รายการ) จะถูกอัปเดตเป็นชื่อใหม่โดยอัตโนมัติ`
                    : `${ingredients.filter((i) => i.category === editingCategoryOldName).length} ingredients in "${getLocalizedText('en', editingCategoryOldName)}" will update automatically.`}
                </div>
              </div>

              <div className="modal-footer bg-[#1a1a1a] flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditCategoryModalOpen(false);
                    setEditCategoryError(null);
                  }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors cursor-pointer"
                >
                  {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl shadow-md shadow-[#F27D26]/20 transition-all cursor-pointer"
                >
                  {lang === 'th' ? 'บันทึกการแก้ไข' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CATEGORY CONFIRMATION MODAL */}
      {isDeleteCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="modal-panel bg-[#1a1a1a] rounded-2xl max-w-md w-full shadow-2xl border border-white/20 text-white animate-in fade-in zoom-in-95 duration-150">
            <div className="modal-header flex items-center justify-between border-b border-white/10">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-400" />
                <span>{lang === 'th' ? 'ยืนยันการลบหมวดหมู่วัตถุดิบ' : 'Confirm Delete Category'}</span>
              </h2>
              <button
                type="button"
                onClick={() => setIsDeleteCategoryModalOpen(false)}
                className="p-1 text-white/50 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3 text-xs">
              <div className="p-3.5 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-rose-200">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-white">
                    {lang === 'th'
                      ? `ต้องการลบหมวดหมู่ "${deletingCategoryName}" ใช่หรือไม่?`
                      : `Delete category "${getLocalizedText('en', deletingCategoryName)}"?`}
                  </p>
                  <p className="text-[11px] leading-relaxed text-white/75">
                    {ingredients.filter((i) => i.category === deletingCategoryName).length > 0
                      ? lang === 'th'
                        ? `วัตถุดิบในหมวดนี้ (${ingredients.filter((i) => i.category === deletingCategoryName).length} รายการ) จะถูกย้ายไปยังหมวด "${allCategories.find((c) => c !== deletingCategoryName) || 'อื่นๆ'}" โดยไม่สูญหาย`
                        : `${ingredients.filter((i) => i.category === deletingCategoryName).length} ingredients will move to "${getLocalizedText('en', allCategories.find((c) => c !== deletingCategoryName) || 'อื่นๆ')}".`
                      : lang === 'th'
                      ? 'ไม่มีวัตถุดิบในหมวดหมู่นี้ ระบบจะลบหมวดหมู่นี้ออกทันที'
                      : 'No ingredients in this category. It will be removed immediately.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="modal-footer bg-[#1a1a1a] flex items-center justify-end gap-2 border-t border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setIsDeleteCategoryModalOpen(false)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold cursor-pointer"
              >
                {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCategory}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{lang === 'th' ? 'ยืนยันการลบหมวดหมู่' : 'Delete Category'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
