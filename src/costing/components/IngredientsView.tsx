import React, { useState } from 'react';
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
import { NumericInput } from './common/NumericInput';

interface IngredientsViewProps {
  ingredients: Ingredient[];
  sauces: Sauce[];
  variants: MenuVariant[];
  menuNamesMap: Map<string, string>;
  settings: RestaurantSettings;
  priceHistory: PriceHistoryRecord[];
  onSaveIngredient: (ingredient: Ingredient) => void;
  onDeleteIngredient?: (id: string) => void;
  onReorderIngredients?: (reordered: Ingredient[]) => void;
  onRecordPriceChange: (record: PriceHistoryRecord) => void;
}

export const IngredientsView: React.FC<IngredientsViewProps> = ({
  ingredients,
  sauces,
  variants,
  menuNamesMap,
  settings,
  priceHistory,
  onSaveIngredient,
  onDeleteIngredient,
  onReorderIngredients,
  onRecordPriceChange,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Partial<Ingredient> | null>(null);
  const [sortOrder, setSortOrder] = useState<'default' | 'asc' | 'desc'>('default');

  // Price Simulation Modal state
  const [isImpactModalOpen, setIsImpactModalOpen] = useState(false);
  const [simulatingIngredient, setSimulatingIngredient] = useState<Ingredient | null>(null);
  const [simulatedNewPrice, setSimulatedNewPrice] = useState<number>(0);
  const [priceChangeReason, setPriceChangeReason] = useState<string>('');

  // Add Category Modal state
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cost_custom_ingredient_categories');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Category order state with localStorage persistence
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cost_ingredient_category_order');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);

  const defaultCategories = [
    'เนื้อสัตว์และอาหารทะเล',
    'ผักและสมุนไพร',
    'เครื่องปรุงและซอส',
    'ข้าวและเส้น',
    'ไข่และเต้าหู้',
    'ของแห้งและเบ็ดเตล็ด',
    'บรรจุภัณฑ์',
  ];

  const rawCategories = Array.from(
    new Set([
      ...defaultCategories,
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

  const categories: string[] = ['ALL', ...allCategories];

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

    if (targetCatName === 'ALL') {
      newOrder.unshift(moved);
    } else {
      const toIndex = newOrder.indexOf(targetCatName);
      if (toIndex === -1) {
        newOrder.push(moved);
      } else {
        newOrder.splice(toIndex, 0, moved);
      }
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
    if (!allCategories.includes(trimmed)) {
      const updated = [...customCategories, trimmed];
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
    setSelectedCategory(trimmed);
    setNewCategoryName('');
    setIsAddCategoryModalOpen(false);
  };

  // Filtered ingredients
  const filteredIngredients = ingredients.filter((ing) => {
    const matchesSearch =
      ing.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (ing.notes && ing.notes.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'ALL' || ing.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Sorted ingredients (Ascending / Descending by name, supporting Thai locale)
  const displayedIngredients = React.useMemo(() => {
    if (sortOrder === 'default') {
      return filteredIngredients;
    }
    return [...filteredIngredients].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, 'th', { sensitivity: 'base', numeric: true });
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [filteredIngredients, sortOrder]);

  // Drag & drop and reorder state
  const [draggedIngredientId, setDraggedIngredientId] = useState<string | null>(null);
  const [dragOverIngredientId, setDragOverIngredientId] = useState<string | null>(null);

  const handleMoveIngredient = (fromId: string, direction: 'up' | 'down') => {
    if (sortOrder !== 'default') {
      setSortOrder('default');
    }
    const fromIndex = ingredients.findIndex((i) => i.id === fromId);
    if (fromIndex === -1) return;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= ingredients.length) return;

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

  const handleDragEnd = () => {
    setDraggedIngredientId(null);
    setDragOverIngredientId(null);
  };

  const handleOpenAdd = () => {
    const defaultCat =
      selectedCategory !== 'ALL'
        ? (selectedCategory as IngredientCategory)
        : ('เนื้อสัตว์และอาหารทะเล' as IngredientCategory);

    const newIng: Partial<Ingredient> = {
      id: `ing_${Date.now()}`,
      name: '',
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
    setEditingIngredient(newIng);
    setIsEditingModalOpen(true);
  };

  const handleOpenEdit = (ing: Ingredient) => {
    const pQty = Number(ing.purchaseQuantity) || 1000;
    const yPct = Number(ing.yieldPercent) || 100;
    const computedActual = ing.actualQuantity !== undefined && ing.actualQuantity !== null
      ? ing.actualQuantity
      : Number(((pQty * yPct) / 100).toFixed(1));
    setEditingIngredient({
      ...ing,
      actualQuantity: computedActual,
      actualUnit: ing.actualUnit || ing.purchaseUnit || 'g',
    });
    setIsEditingModalOpen(true);
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIngredient || !editingIngredient.name) return;

    const calc = calculateIngredientCost(editingIngredient);
    const completeIngredient: Ingredient = {
      id: editingIngredient.id || `ing_${Date.now()}`,
      name: editingIngredient.name,
      category: editingIngredient.category || 'เนื้อสัตว์และอาหารทะเล',
      purchaseQuantity: Number(editingIngredient.purchaseQuantity) || 1,
      purchaseUnit: editingIngredient.purchaseUnit || 'g',
      purchasePrice: Number(editingIngredient.purchasePrice) || 0,
      actualQuantity: Number(editingIngredient.actualQuantity) || Number(editingIngredient.purchaseQuantity) || 1,
      actualUnit: editingIngredient.actualUnit || editingIngredient.purchaseUnit || 'g',
      yieldPercent: Number(editingIngredient.yieldPercent) || 100,
      actualCost: calc.actualCost,
      baseUnit: editingIngredient.baseUnit || editingIngredient.actualUnit || editingIngredient.purchaseUnit || 'g',
      costPerBaseUnit: calc.costPerBaseUnit,
      usageUnit: editingIngredient.usageUnit || 'g',
      piecesPerPurchaseUnit: editingIngredient.piecesPerPurchaseUnit,
      notes: editingIngredient.notes,
      isReviewRequired: editingIngredient.isReviewRequired || false,
      reviewReason: editingIngredient.reviewReason,
      active: editingIngredient.active !== undefined ? editingIngredient.active : true,
      createdAt: editingIngredient.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveIngredient(completeIngredient);
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
      reason: priceChangeReason || 'ปรับราคาจากโปรแกรมจำลองผลกระทบ',
      user: `${settings.userRole} (Tony)`,
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
    <div className="flex flex-col h-[calc(100vh-5.5rem)] min-h-[500px] overflow-hidden -mb-8">
      {/* LOCKED TOP SECTION (Title, Action buttons, Search & Category filters) */}
      <div className="shrink-0 z-20 space-y-3 pb-3 bg-stone-900/40 backdrop-blur-md pt-1">
        {/* Title & Actions */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 shadow-sm">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              ฐานข้อมูลวัตถุดิบและต้นทุน Yield
            </h1>
            <p className="text-xs text-white/60 mt-0.5">
              กำหนดราคาซื้อ, ปริมาณสูญเสีย (Yield %), และต้นทุนต่อหน่วยใช้งานจริงตามสูตรบัญชี
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsAddCategoryModalOpen(true)}
              className="px-3.5 py-2 bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#F27D26]" />
              <span>+ เพิ่มหมวดหมู่</span>
            </button>

            <button
              type="button"
              onClick={handleOpenAdd}
              className="px-4 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ เพิ่มวัตถุดิบใหม่</span>
            </button>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-2.5 sm:p-3 rounded-2xl flex items-center gap-2.5 overflow-x-auto scrollbar-none shadow-sm">
        {/* Compact Search: Magnifying glass icon only to save screen space */}
        <div className="flex items-center gap-2 shrink-0">
          {isSearchExpanded ? (
            <div className="relative flex items-center w-56 sm:w-64 transition-all">
              <Search className="w-4 h-4 absolute left-3 text-white/40 pointer-events-none" />
              <input
                type="text"
                autoFocus
                placeholder="ค้นหาวัตถุดิบ..."
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
                title="ปิดค้นหา"
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
              title="ค้นหาวัตถุดิบ"
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

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <Filter className="w-4 h-4 text-white/40 shrink-0 hidden sm:block mr-0.5" />

          {/* ALL tab */}
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            onDragOver={(e) => handleCategoryDragOver(e, 'ALL')}
            onDrop={(e) => handleCategoryDrop(e, 'ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 ${
              selectedCategory === 'ALL'
                ? 'bg-[#F27D26] text-black font-bold shadow-md shadow-[#F27D26]/20'
                : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/5'
            } ${dragOverCategory === 'ALL' ? 'ring-2 ring-[#F27D26] bg-[#F27D26]/20 border-[#F27D26]' : ''}`}
            title="แสดงวัตถุดิบทั้งหมด (หรือลากหมวดหมู่อื่นมาวางที่นี่เพื่อย้ายไปอันดับแรก)"
          >
            ทั้งหมด
          </button>

          {/* Reorderable Categories */}
          {allCategories.map((cat, index) => {
            const isSelected = selectedCategory === cat;
            const isDragged = draggedCategory === cat;
            const isDragOver = dragOverCategory === cat;
            const isFirst = index === 0;
            const isLast = index === allCategories.length - 1;

            return (
              <div
                key={cat}
                draggable
                onDragStart={(e) => handleCategoryDragStart(e, cat)}
                onDragOver={(e) => handleCategoryDragOver(e, cat)}
                onDrop={(e) => handleCategoryDrop(e, cat)}
                onDragEnd={handleCategoryDragEnd}
                className={`group relative inline-flex items-center rounded-xl text-xs font-semibold whitespace-nowrap transition-all select-none shrink-0 ${
                  isSelected
                    ? 'bg-[#F27D26] text-black font-bold shadow-md shadow-[#F27D26]/20'
                    : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10'
                } ${isDragged ? 'opacity-40 scale-95 ring-2 ring-[#F27D26]' : ''} ${
                  isDragOver ? 'ring-2 ring-[#F27D26] bg-[#F27D26]/20 border-[#F27D26]' : ''
                }`}
                title={`คลิกเลือก | กดค้างแล้วลากวาง หรือใช้ปุ่มลูกศร ซ้าย-ขวา เพื่อย้ายตำแหน่ง`}
              >
                {/* Move Left Button */}
                <button
                  type="button"
                  disabled={isFirst}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveCategory(cat, 'left');
                  }}
                  className={`p-1 pl-1.5 transition-all rounded-l-xl ${
                    isFirst
                      ? 'opacity-20 cursor-not-allowed'
                      : isSelected
                      ? 'hover:bg-black/15 text-black/70 hover:text-black cursor-pointer'
                      : 'text-white/40 hover:text-white hover:bg-white/10 cursor-pointer'
                  }`}
                  title={`ย้ายหมวดหมู่ "${cat}" ไปทางซ้าย`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                {/* Category Label with Drag Grip */}
                <div
                  onClick={() => setSelectedCategory(cat)}
                  className="flex items-center gap-1.5 px-1 py-1.5 cursor-grab active:cursor-grabbing"
                >
                  <GripVertical
                    className={`w-3 h-3 shrink-0 ${
                      isSelected
                        ? 'text-black/50 group-hover:text-black'
                        : 'text-white/30 group-hover:text-white/70'
                    }`}
                  />
                  <span>{cat}</span>
                </div>

                {/* Move Right Button */}
                <button
                  type="button"
                  disabled={isLast}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveCategory(cat, 'right');
                  }}
                  className={`p-1 pr-1.5 transition-all rounded-r-xl ${
                    isLast
                      ? 'opacity-20 cursor-not-allowed'
                      : isSelected
                      ? 'hover:bg-black/15 text-black/70 hover:text-black cursor-pointer'
                      : 'text-white/40 hover:text-white hover:bg-white/10 cursor-pointer'
                  }`}
                  title={`ย้ายหมวดหมู่ "${cat}" ไปทางขวา`}
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
      <div className="flex-1 min-h-0 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-xl flex flex-col mb-4">
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-[#161618] border-b border-white/15 shadow-sm">
              <tr className="text-white/70 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-3 w-12 text-center">ลำดับ</th>
                <th className="py-3 px-4 select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSortOrder((prev) => (prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default'));
                      }}
                      className="flex items-center gap-1 font-bold uppercase tracking-wider text-[10px] text-white/70 hover:text-white transition-colors cursor-pointer group"
                      title="คลิกเพื่อสลับ: ลำดับปกติ -> น้อยไปมาก (ก-ฮ) -> มากไปน้อย (ฮ-ก)"
                    >
                      <span>วัตถุดิบ</span>
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
                        title="เรียงลำดับจากน้อยไปมาก (ก-ฮ)"
                      >
                        <ArrowUp className="w-2.5 h-2.5" />
                        <span>ก-ฮ</span>
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
                        title="เรียงลำดับจากมากไปน้อย (ฮ-ก)"
                      >
                        <ArrowDown className="w-2.5 h-2.5" />
                        <span>ฮ-ก</span>
                      </button>
                    </div>
                  </div>
                </th>
                <th className="py-3 px-3">ปริมาณที่ซื้อ</th>
                <th className="py-3 px-3">ราคาซื้อ</th>
                <th className="py-3 px-3">Yield (%)</th>
                <th className="py-3 px-3">น้ำหนักสุทธิ</th>
                <th className="py-3 px-3">ต้นทุนจริงหลัง Yield</th>
                <th className="py-3 px-3">ต้นทุนต่อหน่วยใช้งาน</th>
                <th className="py-3 px-4 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayedIngredients.map((ing) => {
                const isShrimp = ing.usageUnit === 'ตัว';
                const isDragged = draggedIngredientId === ing.id;
                const isDragOver = dragOverIngredientId === ing.id;
                const globalIndex = ingredients.findIndex((i) => i.id === ing.id);
                const isFirst = globalIndex <= 0;
                const isLast = globalIndex === -1 || globalIndex >= ingredients.length - 1;

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
                          title="กดค้างแล้วลากเพื่อย้ายตำแหน่ง"
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
                            title="ย้ายขึ้น"
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
                            title="ย้ายลง"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </td>

                    <td
                      className="py-3.5 px-4 font-semibold text-white cursor-pointer select-none"
                      onDoubleClick={() => handleOpenEdit(ing)}
                      title="ดับเบิลคลิกเพื่อแก้ไขข้อมูลวัตถุดิบ"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="hover:text-[#F27D26] hover:underline transition-colors">
                          {ing.name}
                        </span>
                        {(!ing.purchasePrice || ing.purchasePrice <= 0) && (
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            title="ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง"
                          >
                            ยังไม่ได้ใส่ราคาวัตถุดิบ ต้นทุนอาจต่ำเกินจริง
                          </span>
                        )}
                        {ing.isReviewRequired && (!ing.purchasePrice || ing.purchasePrice > 0) && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30"
                            title={ing.reviewReason}
                          >
                            รอตรวจทาน
                          </span>
                        )}
                        {!ing.active && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white/40">
                            ระงับ
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-white/70 font-mono">
                      {ing.purchaseQuantity.toLocaleString()} {ing.purchaseUnit}
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
                      {ing.actualQuantity} {ing.actualUnit}
                    </td>
                    <td className="py-3.5 px-3 font-mono font-semibold text-white/80">
                      ฿{ing.actualCost.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-mono font-bold text-[#FFC107] text-xs">
                        ฿{ing.costPerBaseUnit.toFixed(4)} / {ing.usageUnit}
                      </div>
                      {isShrimp && ing.piecesPerPurchaseUnit && (
                        <div className="text-[10px] text-white/40 font-normal">
                          ({ing.piecesPerPurchaseUnit} ตัว/กล่อง)
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {/* Edit button */}
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(ing)}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                        title="แก้ไขวัตถุดิบ"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={() => onDeleteIngredient?.(ing.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors cursor-pointer"
                        title="ลบวัตถุดิบ"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {displayedIngredients.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-white/40 text-xs">
                    ไม่พบรายการวัตถุดิบ
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
          <div className="bg-[#1a1a1a]/95 backdrop-blur-2xl rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-white/20 text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h2 className="text-lg font-bold text-white">
                {editingIngredient.id ? 'แก้ไขข้อมูลวัตถุดิบ' : 'เพิ่มวัตถุดิบใหม่'}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditingModalOpen(false)}
                className="p-1 text-white/50 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4 mt-4 text-xs">
              {/* Name & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-white/80 mb-1">
                    ชื่อวัตถุดิบ <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editingIngredient.name || ''}
                    onChange={(e) =>
                      setEditingIngredient({ ...editingIngredient, name: e.target.value })
                    }
                    className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none"
                    placeholder="เช่น หมูหมัก, กุ้งสด XL"
                  />
                </div>

                <div>
                  <label className="block font-bold text-white/80 mb-1">หมวดหมู่</label>
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
                    {categories
                      .filter((c) => c !== 'ALL')
                      .map((cat) => (
                        <option key={cat} value={cat} className="bg-[#1a1a1a] text-white">
                          {cat}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Purchase Details */}
              <div className="p-3.5 bg-white/5 rounded-2xl border border-white/10 space-y-3">
                <div className="font-bold text-[#F27D26] text-xs uppercase tracking-wider">
                  ข้อมูลการซื้อ (Purchase Specs)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-white/60 mb-1">ปริมาณที่ซื้อ</label>
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
                      placeholder="เช่น 1000"
                    />
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">หน่วยซื้อ</label>
                    <select
                      value={editingIngredient.purchaseUnit || 'g'}
                      onChange={(e) => {
                        const newUnit = e.target.value as UnitType;
                        setEditingIngredient({
                          ...editingIngredient,
                          purchaseUnit: newUnit,
                          actualUnit: newUnit,
                          baseUnit: newUnit,
                        });
                      }}
                      className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white cursor-pointer"
                    >
                      <option value="g" className="bg-[#1a1a1a]">g (กรัม)</option>
                      <option value="kg" className="bg-[#1a1a1a]">kg (กิโลกรัม)</option>
                      <option value="ml" className="bg-[#1a1a1a]">ml (มิลลิลิตร)</option>
                      <option value="L" className="bg-[#1a1a1a]">L (ลิตร)</option>
                      <option value="ชิ้น" className="bg-[#1a1a1a]">ชิ้น</option>
                      <option value="กล่อง" className="bg-[#1a1a1a]">กล่อง</option>
                      <option value="ถุง" className="bg-[#1a1a1a]">ถุง</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">ราคาซื้อ (บาท)</label>
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

                {/* Row 2: Actual Quantity after trimming & Yield Auto-calculation comparison */}
                <div className="grid grid-cols-3 gap-3 pt-2.5 border-t border-white/10">
                  <div>
                    <label className="block text-emerald-400 font-bold mb-1">
                      ปริมาณที่ได้จริง(หลังตัดแต่ง)
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
                      placeholder="เช่น 950"
                    />
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">หน่วยที่ได้จริง</label>
                    <div className="w-full p-2 bg-black/20 border border-white/10 rounded-xl text-white/80 font-mono text-sm flex items-center justify-between">
                      <span>{editingIngredient.actualUnit || editingIngredient.purchaseUnit || 'g'}</span>
                      <span className="text-[10px] text-white/40">พร้อมปรุง</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-white/60 mb-1">Yield (%) คำนวณอัตโนมัติ</label>
                    <div className="w-full p-2 bg-black/40 border border-emerald-500/30 rounded-xl font-mono flex items-center justify-between">
                      <span className="font-bold text-emerald-400 text-sm">
                        {editingIngredient.yieldPercent ?? 100}%
                      </span>
                      {editingIngredient.purchaseQuantity && editingIngredient.actualQuantity !== undefined && (
                        <span className="text-[10px] text-rose-300">
                          {Number(editingIngredient.purchaseQuantity) > Number(editingIngredient.actualQuantity)
                            ? `สูญเสีย -${(Number(editingIngredient.purchaseQuantity) - Number(editingIngredient.actualQuantity)).toFixed(1)} ${editingIngredient.purchaseUnit || 'g'}`
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
                  การเตรียมและ Yield (Preparation & Yield %)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/60 mb-1">Yield (%) หลังตัดแต่ง</label>
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
                    <label className="block text-white/60 mb-1">หน่วยใช้งานในสูตร</label>
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
                      <option value="g" className="bg-[#1a1a1a]">g (กรัม)</option>
                      <option value="ตัว" className="bg-[#1a1a1a]">ตัว (คิดเป็นตัว เช่น กุ้ง)</option>
                      <option value="ฟอง" className="bg-[#1a1a1a]">ฟอง (ไข่ไก่)</option>
                      <option value="ml" className="bg-[#1a1a1a]">ml (มิลลิลิตร)</option>
                      <option value="ชิ้น" className="bg-[#1a1a1a]">ชิ้น</option>
                      <option value="จาน" className="bg-[#1a1a1a]">จาน</option>
                    </select>
                  </div>
                </div>

                {/* Shrimp pieces definition */}
                {editingIngredient.usageUnit === 'ตัว' && (
                  <div className="mt-2 p-2.5 bg-[#FFC107]/10 rounded-xl border border-[#FFC107]/30 text-[11px] text-white/90">
                    <span className="font-bold text-[#FFC107]">กุ้ง / ของคิดเป็นตัว:</span> ระบุจำนวนตัวต่อรอบซื้อ
                    (เช่น 60 ตัว = 510 บาท ต้นทุน 8.50 บาท/ตัว)
                    <div className="mt-1 flex items-center gap-2">
                      <span>จำนวนตัวที่ใช้ได้:</span>
                      <NumericInput
                        type="number"
                        value={editingIngredient.piecesPerPurchaseUnit || ''}
                        onChange={(e) =>
                          setEditingIngredient({
                            ...editingIngredient,
                            piecesPerPurchaseUnit: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-24 p-1 bg-black/40 border border-white/20 rounded font-bold text-white"
                        placeholder="เช่น 60"
                      />
                      <span>ตัว</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Calculated preview */}
              {(() => {
                const previewCalc = calculateIngredientCost(editingIngredient);
                return (
                  <div className="p-3 bg-black/40 border border-white/10 rounded-2xl flex items-center justify-between font-mono">
                    <div>
                      <div className="text-[10px] text-white/40">ต้นทุนจริงหลังหัก Yield</div>
                      <div className="font-bold text-sm text-white">฿{previewCalc.actualCost.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-[#F27D26]">ต้นทุนต่อหน่วยใช้งาน ({editingIngredient.usageUnit})</div>
                      <div className="font-bold text-base text-[#FFC107]">
                        ฿{previewCalc.costPerBaseUnit.toFixed(6)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsEditingModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold transition-colors cursor-pointer"
                >
                  บันทึกข้อมูล
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRICE CHANGE IMPACT SIMULATION MODAL */}
      {isImpactModalOpen && simulatingIngredient && impactAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-[#1a1a1a]/95 backdrop-blur-2xl rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-white/20 text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#F27D26] uppercase">
                  <Sparkles className="w-4 h-4" />
                  <span>โปรแกรมจำลองผลกระทบการปรับราคา (Impact Engine)</span>
                </div>
                <h2 className="text-xl font-bold text-white mt-1">
                  {simulatingIngredient.name}
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

            <div className="mt-5 space-y-4 text-xs">
              {/* Price inputs */}
              <div className="grid grid-cols-2 gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                <div>
                  <span className="text-white/50 font-medium">ราคาซื้อเดิม:</span>
                  <div className="text-base font-bold text-white font-mono mt-0.5">
                    ฿{simulatingIngredient.purchasePrice.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-white/50">
                    (฿{simulatingIngredient.costPerBaseUnit.toFixed(4)} / {simulatingIngredient.usageUnit})
                  </div>
                </div>

                <div>
                  <span className="text-[#F27D26] font-bold">ราคาซื้อใหม่ที่จำลอง:</span>
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
                    (฿{impactAnalysis.newCostPerBaseUnit.toFixed(4)} / {simulatingIngredient.usageUnit})
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-white/80 mb-1">เหตุผลในการปรับราคา:</label>
                <input
                  type="text"
                  value={priceChangeReason}
                  onChange={(e) => setPriceChangeReason(e.target.value)}
                  className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none"
                  placeholder="เช่น ราคาหน้าฟาร์มขยับขึ้น, น้ำมันแพง..."
                />
              </div>

              {/* Affected Sauces */}
              {impactAnalysis.affectedSauces.length > 0 && (
                <div className="p-3.5 bg-[#FFC107]/10 border border-[#FFC107]/20 rounded-2xl space-y-2">
                  <div className="font-bold text-[#FFC107] text-[11px] uppercase">
                    ซอสที่ได้รับผลกระทบ ({impactAnalysis.affectedSauces.length} รายการ)
                  </div>
                  <div className="space-y-1.5">
                    {impactAnalysis.affectedSauces.map((s) => (
                      <div
                        key={s.sauceId}
                        className="flex items-center justify-between bg-black/30 p-2.5 rounded-xl border border-white/5 font-mono text-xs"
                      >
                        <span className="font-bold text-white">{s.sauceName}</span>
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
                  เมนูที่ได้รับผลกระทบ (Affected Menus) ({impactAnalysis.affectedVariants.length} เมนู)
                </div>
                {impactAnalysis.affectedVariants.length === 0 ? (
                  <div className="p-4 text-center text-white/50 bg-white/5 rounded-xl">
                    ไม่มีเมนูใดในระบบที่ใช้หรืออิงวัตถุดิบชิ้นนี้
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
                            {v.menuName} - {v.variantName}
                          </span>
                          <span className="font-mono font-bold text-white/80">
                            ราคาขาย ฿{v.sellingPrice}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1 border-t border-white/10">
                          <div>
                            <span className="text-white/50">ต้นทุนรวมใหม่:</span>
                            <div className="font-bold text-[#FFC107]">
                              ฿{v.newTotalCost.toFixed(2)}{' '}
                              <span className="text-[10px] text-red-400">
                                (+฿{v.costDiff.toFixed(2)})
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-white/50">กำไรสุทธิใหม่:</span>
                            <div className="font-bold text-green-400">
                              ฿{v.newProfit.toFixed(2)}{' '}
                              <span className="text-[10px] text-red-400">
                                ({v.profitDiff < 0 ? '' : '+'}฿{v.profitDiff.toFixed(2)})
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-white/50">ราคาแนะนำใหม่:</span>
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

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsImpactModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors cursor-pointer"
                >
                  ปิดหน้าต่าง
                </button>

                <button
                  type="button"
                  onClick={handleApplySimulatedPrice}
                  className="px-5 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold shadow-md shadow-[#F27D26]/20 transition-colors cursor-pointer"
                >
                  อนุมัติและปรับใช้ราคาใหม่นี้ (฿{simulatedNewPrice})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD CATEGORY MODAL */}
      {isAddCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="bg-[#1a1a1a]/95 backdrop-blur-2xl rounded-2xl max-w-md w-full p-6 shadow-2xl border border-white/20 text-white animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#F27D26]" />
                <span>เพิ่มหมวดหมู่วัตถุดิบใหม่</span>
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

            <form onSubmit={handleAddCategory} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-white/80 mb-1.5">
                  ชื่อหมวดหมู่ใหม่ <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl text-white font-medium focus:border-[#F27D26] focus:outline-none placeholder-white/30"
                  placeholder="เช่น เครื่องดื่ม, ของหวาน, เบเกอรี่, อาหารแปรรูป"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddCategoryModalOpen(false);
                    setNewCategoryName('');
                  }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl shadow-md shadow-[#F27D26]/20 transition-all cursor-pointer"
                >
                  บันทึกหมวดหมู่
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
