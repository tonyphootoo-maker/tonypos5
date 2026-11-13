import React, { useState } from 'react';
import {
  MenuItem,
  MenuVariant,
  Ingredient,
  Sauce,
  RestaurantSettings,
  RecipeCostBreakdown,
} from '../types';
import { Plus, SlidersHorizontal, Store, Bike, Smartphone, Flame, LayoutGrid, UtensilsCrossed, Edit2, Trash2, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';

export type PricingChannelTab = 'DINE_IN' | 'GRAB' | 'LINEMAN' | 'ROBINHOOD' | 'ALL';
export type ServingDishMode = 'ON_RICE' | 'A_LA_CARTE';

interface MenuPricingSpreadsheetTableProps {
  menu: MenuItem;
  ingredientsMap: Map<string, Ingredient>;
  saucesMap: Map<string, Sauce>;
  settings: RestaurantSettings;
  onSaveMenu: (menu: MenuItem) => void;
  onSelectBreakdown?: (data: {
    menu: MenuItem;
    variant: MenuVariant;
    breakdown: RecipeCostBreakdown;
  }) => void;
  onOpenAddVariant?: (menu: MenuItem) => void;
  onEditVariant?: (menu: MenuItem, variant: MenuVariant) => void;
  onDeleteVariant?: (menu: MenuItem, variantId: string) => void;
  activeChannel?: PricingChannelTab;
  onChannelChange?: (channel: PricingChannelTab) => void;
  activeServingMode?: ServingDishMode;
  onServingModeChange?: (mode: ServingDishMode) => void;
}

export const MenuPricingSpreadsheetTable: React.FC<MenuPricingSpreadsheetTableProps> = ({
  menu,
  ingredientsMap,
  saucesMap,
  settings,
  onSaveMenu,
  onSelectBreakdown,
  onOpenAddVariant,
  onEditVariant,
  onDeleteVariant,
  activeChannel: parentChannel,
  onChannelChange,
  activeServingMode: parentServingMode,
  onServingModeChange,
}) => {
  // Channel view: DINE_IN (กินที่ร้าน), GRAB, LINEMAN, ROBINHOOD, ALL (แสดงทั้งหมด)
  const [localChannel, setLocalChannel] = useState<PricingChannelTab>('DINE_IN');
  const currentChannel = parentChannel || localChannel;

  // Serving Mode: ON_RICE (ราดข้าว / จานเดียว) vs A_LA_CARTE (กับข้าว / จานกลาง)
  const [localServingMode, setLocalServingMode] = useState<ServingDishMode>('ON_RICE');
  const currentServingMode = parentServingMode || localServingMode;

  const handleSelectServingMode = (mode: ServingDishMode) => {
    setLocalServingMode(mode);
    if (onServingModeChange) {
      onServingModeChange(mode);
    }
  };

  const handleSelectChannel = (ch: PricingChannelTab) => {
    setLocalChannel(ch);
    if (onChannelChange) {
      onChannelChange(ch);
    }
  };

  // Delivery GP rates with 7% VAT linked directly to restaurant settings
  const grabCommissionBase = settings.grabFoodCommissionPercent ?? 30;
  const grabGpRateWithVat = (grabCommissionBase * 1.07) / 100;
  const grabGpPctDisplay = (grabCommissionBase * 1.07).toFixed(2);

  const linemanCommissionBase = settings.lineManCommissionPercent ?? 25;
  const linemanGpRateWithVat = (linemanCommissionBase * 1.07) / 100;
  const linemanGpPctDisplay = (linemanCommissionBase * 1.07).toFixed(2);

  // State & Handlers for reordering meat variants (Drag & Drop + Up/Down arrows)
  const [draggedVariantId, setDraggedVariantId] = useState<string | null>(null);
  const [dragOverVariantId, setDragOverVariantId] = useState<string | null>(null);

  const handleMoveVariant = (variantId: string, direction: 'up' | 'down') => {
    const fromIndex = menu.variants.findIndex((v) => v.id === variantId);
    if (fromIndex === -1) return;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= menu.variants.length) return;
    const updated = [...menu.variants];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onSaveMenu({ ...menu, variants: updated });
  };

  const handleToggleOutOfStock = (variantId: string) => {
    const updated = menu.variants.map((v) =>
      v.id === variantId ? { ...v, isOutOfStock: !v.isOutOfStock } : v
    );
    onSaveMenu({ ...menu, variants: updated });
  };

  const handleVariantDragStart = (e: React.DragEvent, id: string) => {
    setDraggedVariantId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {}
  };

  const handleVariantDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverVariantId !== id) {
      setDragOverVariantId(id);
    }
  };

  const handleVariantDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggedVariantId || e.dataTransfer.getData('text/plain');
    setDraggedVariantId(null);
    setDragOverVariantId(null);
    if (!sourceId || sourceId === targetId) return;

    const fromIndex = menu.variants.findIndex((v) => v.id === sourceId);
    const toIndex = menu.variants.findIndex((v) => v.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const updated = [...menu.variants];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onSaveMenu({ ...menu, variants: updated });
  };

  const handleVariantDragEnd = () => {
    setDraggedVariantId(null);
    setDragOverVariantId(null);
  };

  // Local state for real-time responsiveness when typing
  const [localEdits, setLocalEdits] = useState<
    Record<
      string,
      {
        sellingPrice?: number;
        proteinWeight?: number;
        grabPrice?: number;
        linemanPrice?: number;
        robinhoodPrice?: number;
        seafoodShrimpQty?: number;
        seafoodSquidQty?: number;
      }
    >
  >({});

  const handleCellChange = (
    variantId: string,
    field: 'sellingPrice' | 'proteinWeight' | 'grabPrice' | 'linemanPrice' | 'robinhoodPrice',
    val: number
  ) => {
    const editKey = `${variantId}_${currentServingMode}`;
    // 1. Update local state for immediate visual feedback
    setLocalEdits((prev) => ({
      ...prev,
      [editKey]: {
        ...prev[editKey],
        [field]: val,
      },
      // Keep base variantId synced for ON_RICE mode
      [variantId]: {
        ...prev[variantId],
        [field]: val,
      },
    }));

    // 2. Update and persist in menu if in standard ON_RICE mode
    if (currentServingMode === 'ON_RICE') {
      const updatedVariants = menu.variants.map((v) => {
        if (v.id !== variantId) return v;

        if (field === 'sellingPrice') {
          const boxMarkup =
            v.takeawayPrice && v.sellingPrice && v.takeawayPrice > v.sellingPrice
              ? v.takeawayPrice - v.sellingPrice
              : 0;
          return { ...v, sellingPrice: val, takeawayPrice: val + boxMarkup };
        }
        if (field === 'grabPrice') {
          return { ...v, grabPrice: val, deliveryPrice: val };
        }
        if (field === 'linemanPrice') {
          return { ...v, linemanPrice: val };
        }
        if (field === 'robinhoodPrice') {
          return { ...v, robinhoodPrice: val };
        }
        if (field === 'proteinWeight') {
          const recipeItems = [...(v.recipeItems || [])];
          const proteinIdx = recipeItems.findIndex((it) => {
            const lower = it.name.toLowerCase();
            return (
              it.proteinCategory ||
              lower.includes('หมู') ||
              lower.includes('ไก่') ||
              lower.includes('เนื้อ') ||
              lower.includes('กุ้ง') ||
              lower.includes('หมึก') ||
              lower.includes('ไส้กรอก') ||
              lower.includes('ปลา')
            );
          });

          if (proteinIdx >= 0) {
            const item = recipeItems[proteinIdx];
            const unitCost = item.calculatedUnitCost || 0;
            recipeItems[proteinIdx] = {
              ...item,
              quantity: val,
              calculatedLineCost: val * unitCost,
            };
          }
          return { ...v, recipeItems };
        }
        return v;
      });

      const updatedMenu: MenuItem = {
        ...menu,
        variants: updatedVariants,
        updatedAt: new Date().toISOString(),
      };

      onSaveMenu(updatedMenu);
    }
  };

  // Handler for Seafood dual inputs: Shrimp (ตัว) and Squid (g)
  const handleSeafoodChange = (
    variantId: string,
    type: 'shrimp' | 'squid',
    val: number
  ) => {
    const editKey = `${variantId}_${currentServingMode}`;
    setLocalEdits((prev) => ({
      ...prev,
      [editKey]: {
        ...prev[editKey],
        [type === 'shrimp' ? 'seafoodShrimpQty' : 'seafoodSquidQty']: val,
      },
      [variantId]: {
        ...prev[variantId],
        [type === 'shrimp' ? 'seafoodShrimpQty' : 'seafoodSquidQty']: val,
      },
    }));

    const updatedVariants = menu.variants.map((v) => {
      if (v.id !== variantId) return v;
      const recipeItems = [...(v.recipeItems || [])];
      let found = false;
      recipeItems.forEach((it, idx) => {
        const lower = it.name.toLowerCase();
        if (type === 'shrimp' && (lower.includes('กุ้ง') || it.proteinCategory === 'SHRIMP')) {
          found = true;
          const unitCost = it.calculatedUnitCost || 8.5;
          recipeItems[idx] = {
            ...it,
            quantity: val,
            calculatedLineCost: val * unitCost,
          };
        } else if (type === 'squid' && (lower.includes('หมึก') || it.proteinCategory === 'SQUID')) {
          found = true;
          const unitCost = it.calculatedUnitCost || 0.388;
          recipeItems[idx] = {
            ...it,
            quantity: val,
            calculatedLineCost: val * unitCost,
          };
        }
      });
      if (!found) {
        if (type === 'shrimp') {
          recipeItems.push({
            id: `sea_shrimp_${Date.now()}`,
            ingredientId: `sea_shrimp_${Date.now()}`,
            name: 'กุ้งสด (XL)',
            quantity: val,
            unit: 'ตัว',
            proteinCategory: 'SHRIMP',
            calculatedUnitCost: 8.5,
            calculatedLineCost: val * 8.5,
          });
        } else {
          recipeItems.push({
            id: `sea_squid_${Date.now()}`,
            ingredientId: `sea_squid_${Date.now()}`,
            name: 'ปลาหมึกกล้วยสด',
            quantity: val,
            unit: 'g',
            proteinCategory: 'SQUID',
            calculatedUnitCost: 0.388,
            calculatedLineCost: val * 0.388,
          });
        }
      }
      return { ...v, recipeItems };
    });

    onSaveMenu({
      ...menu,
      variants: updatedVariants,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="bg-[#FAF8F5] border border-stone-300 rounded-2xl overflow-hidden shadow-md my-2 text-stone-900 font-sans">
      {/* Top Header Row with Menu Title, Serving Mode & Channel Switcher Buttons */}
      <div className="bg-white border-b border-stone-300 px-4 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Serving Mode Badge - Ultra High Contrast */}
          <span
            className={`px-3 py-1 !text-white font-black text-xs sm:text-sm rounded-lg shadow-xs tracking-wider flex items-center gap-1 border ${
              currentServingMode === 'ON_RICE'
                ? 'bg-rose-600 border-rose-700'
                : 'bg-purple-700 border-purple-800'
            }`}
          >
            {currentServingMode === 'ON_RICE' ? '🍚 จานเดียว / ราดข้าว' : '🍲 กับข้าว (จานกลาง)'}
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-stone-950 tracking-tight">
            {menu.name}
          </h2>
          <span className="text-xs px-2 py-0.5 bg-stone-100 border border-stone-300 text-stone-700 rounded-md font-bold">
            {menu.variants.length} ตัวเลือก
          </span>

          {/* Serving Mode Switcher Buttons - Distinct High Contrast */}
          <div className="flex items-center bg-stone-200 p-0.5 rounded-xl border border-stone-300 shadow-2xs ml-0 sm:ml-2">
            <button
              type="button"
              onClick={() => handleSelectServingMode('ON_RICE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                currentServingMode === 'ON_RICE'
                  ? 'bg-rose-600 !text-white shadow-xs border border-rose-700'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
              title="คำนวณต้นทุนอาหารจานเดียวแบบราดข้าว (รวมข้าวสวย 200g, ปริมาณเนื้อสัตว์จานเดี่ยว)"
            >
              <span>🍚 จานเดียว / ราดข้าว</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectServingMode('A_LA_CARTE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                currentServingMode === 'A_LA_CARTE'
                  ? 'bg-purple-700 !text-white shadow-xs border border-purple-800'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
              title="คำนวณต้นทุนอาหารเป็นกับข้าว (ไม่รวมข้าวสวย, กำหนดราคาและปริมาณเนื้อสัตว์ได้เอง)"
            >
              <span>🍲 กับข้าว</span>
            </button>
          </div>
        </div>

        {/* Channel Selector Buttons: กินที่ร้าน / Grab Food / Line Man / Robinhood / แสดงทั้งหมด */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-stone-200 p-1 rounded-xl border border-stone-300 shadow-2xs">
            {/* กินที่ร้าน */}
            <button
              type="button"
              onClick={() => handleSelectChannel('DINE_IN')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                currentChannel === 'DINE_IN'
                  ? 'bg-cyan-700 !text-white shadow-xs'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>กินที่ร้าน</span>
            </button>

            {/* Grab Food */}
            <button
              type="button"
              onClick={() => handleSelectChannel('GRAB')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                currentChannel === 'GRAB'
                  ? 'bg-[#00873e] !text-white shadow-xs'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
            >
              <Bike className="w-3.5 h-3.5" />
              <span>Grab Food</span>
            </button>

            {/* Line Man */}
            <button
              type="button"
              onClick={() => handleSelectChannel('LINEMAN')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                currentChannel === 'LINEMAN'
                  ? 'bg-[#05963c] !text-white shadow-xs'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Line Man</span>
            </button>

            {/* Robinhood */}
            <button
              type="button"
              onClick={() => handleSelectChannel('ROBINHOOD')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                currentChannel === 'ROBINHOOD'
                  ? 'bg-[#6d28d9] !text-white shadow-xs'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Robinhood</span>
            </button>

            {/* แสดงทั้งหมด (All Channels) */}
            <button
              type="button"
              onClick={() => handleSelectChannel('ALL')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                currentChannel === 'ALL'
                  ? 'bg-stone-900 !text-white shadow-xs'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
              title="เปรียบเทียบทุกช่องทางพร้อมกัน"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">แสดงทั้งหมด</span>
            </button>
          </div>

          {onOpenAddVariant && (
            <button
              type="button"
              onClick={() => onOpenAddVariant(menu)}
              className="px-3 py-1.5 bg-[#F27D26] hover:bg-[#d96817] !text-white font-black text-xs rounded-xl shadow-xs flex items-center gap-1 cursor-pointer transition-colors border border-[#c2580e]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ เพิ่มตัวเลือก</span>
            </button>
          )}
        </div>
      </div>

      {/* Spreadsheet Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse text-center">
          <thead>
            {/* Header Tier 1: Groupings */}
            <tr className="text-xs font-black select-none border-b border-black">
              {currentChannel === 'DINE_IN' && (
                <>
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">ข้อมูลเมนู</th>
                  <th colSpan={8} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">ต้นทุนวัตถุดิบ & การตั้งราคาหน้าร้าน</th>
                  <th colSpan={2} className="bg-cyan-700 !text-white font-black py-1.5 tracking-wide">กำไรหน้าร้าน</th>
                </>
              )}

              {currentChannel === 'GRAB' && (
                <>
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">ข้อมูลเมนู</th>
                  <th colSpan={4} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">ต้นทุนอ้างอิง</th>
                  <th colSpan={6} className="bg-[#00873e] !text-white font-black py-1.5 tracking-wide">Grab Food (GP {grabGpPctDisplay}% รวม VAT)</th>
                </>
              )}

              {currentChannel === 'LINEMAN' && (
                <>
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">ข้อมูลเมนู</th>
                  <th colSpan={4} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">ต้นทุนอ้างอิง</th>
                  <th colSpan={6} className="bg-[#FFB300] text-stone-950 font-black py-1.5 tracking-wide">Line Man (GP {linemanGpPctDisplay}% รวม VAT)</th>
                </>
              )}

              {currentChannel === 'ROBINHOOD' && (
                <>
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">ข้อมูลเมนู</th>
                  <th colSpan={4} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">ต้นทุนอ้างอิง</th>
                  <th colSpan={6} className="bg-[#6d28d9] !text-white font-black py-1.5 tracking-wide">Robinhood (0% GP)</th>
                </>
              )}

              {currentChannel === 'ALL' && (
                <>
                  <th colSpan={10} className="bg-[#FAF8F5] border-r border-black py-1"></th>
                  <th colSpan={12} className="bg-[#FFFF00] text-stone-950 text-sm font-black py-1.5 border-b border-black tracking-wide">
                    กำไรแต่ละรายการ
                  </th>
                </>
              )}
            </tr>

            {/* Header Tier 2: Sub-banners if ALL channels */}
            {currentChannel === 'ALL' && (
              <tr className="text-xs font-bold select-none border-b border-black">
                <th colSpan={10} className="bg-[#FAF8F5] border-r border-black"></th>
                <th colSpan={2} className="bg-cyan-700 !text-white font-black py-1 border-r border-black">ที่ร้าน</th>
                <th colSpan={5} className="bg-[#00873e] !text-white font-black py-1 border-r border-black">Grab Food</th>
                <th colSpan={5} className="bg-[#FFB300] text-stone-950 font-black py-1">Line Man</th>
              </tr>
            )}

            {/* Header Tier 3: Detailed Column Headers per Active Channel */}
            <tr className="text-[11px] font-bold text-stone-900 border-b-2 border-black whitespace-nowrap">
              {/* Common Columns */}
              <th className="py-2.5 px-2 bg-[#E53935] text-white border-r border-black min-w-[70px]">ลำดับ</th>
              <th className="py-2.5 px-3 bg-[#90CAF9] text-stone-900 border-r border-black text-left min-w-[120px]">รายการ</th>

              {/* DINE_IN COLUMNS */}
              {currentChannel === 'DINE_IN' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FFD54F] text-stone-900 border-r border-black min-w-[85px]">
                    <div>ราคาตั้งขาย</div>
                    <div className="text-[10px] text-stone-700">ที่ร้าน (บาท) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>น้ำหนักเนื้อที่ใช้</div>
                    <div className="text-[10px] text-stone-700">(กรัม / ตัว) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[80px]">
                    <div>ราคาต้นทุน</div>
                    <div className="text-[10px] text-stone-600"><span className="text-rose-600 font-bold">เนื้อ</span>/จาน</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>ต้นทุนวัตถุดิบ</div>
                    <div className="text-[10px] text-stone-600">กลาง (บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>ต้นทุนวัตถุดิบ</div>
                    <div className="text-[10px] text-stone-600">ทั้งหมด (บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">
                    <div>ต้นทุนแฝง</div>
                    <div className="text-[10px] text-stone-600">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[70px]">
                    <div>ต้นทุนรวม</div>
                    <div className="text-[10px] text-stone-700">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">% ต้นทุน</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>กำไร</div>
                    <div className="text-[10px] text-stone-700">กินที่ร้าน (บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 min-w-[75px]">
                    <div>กำไร</div>
                    <div className="text-[10px] text-stone-700">ใส่กล่อง (บาท)</div>
                  </th>
                </>
              )}

              {/* GRAB COLUMNS */}
              {currentChannel === 'GRAB' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FAF8F5] text-stone-700 border-r border-black min-w-[75px]">
                    <div>ราคาหน้าร้าน</div>
                    <div className="text-[10px] text-stone-500">(อ้างอิง)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>น้ำหนักเนื้อที่ใช้</div>
                    <div className="text-[10px] text-stone-700">(กรัม / ตัว) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">
                    <div>ต้นทุนรวม</div>
                    <div className="text-[10px] text-stone-700">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">% ต้นทุน</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[85px]">
                    <div>ราคาที่ต้องตั้ง</div>
                    <div className="text-[10px] text-stone-600">ขาย (1.5x)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[85px]">
                    <div>ราคา</div>
                    <div className="text-[10px] text-stone-700">ตั้งเอง (บาท) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>ถูกหัก GP ไป</div>
                    <div className="text-[10px] text-stone-600">({grabGpPctDisplay}%)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>หลังหัก</div>
                    <div className="text-[10px] text-stone-600">เหลือ (บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>กำไรที่ได้</div>
                    <div className="text-[10px] text-stone-700">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 min-w-[65px]">% Margin</th>
                </>
              )}

              {/* LINEMAN COLUMNS */}
              {currentChannel === 'LINEMAN' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FAF8F5] text-stone-700 border-r border-black min-w-[75px]">
                    <div>ราคาหน้าร้าน</div>
                    <div className="text-[10px] text-stone-500">(อ้างอิง)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>น้ำหนักเนื้อที่ใช้</div>
                    <div className="text-[10px] text-stone-700">(กรัม / ตัว) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">
                    <div>ต้นทุนรวม</div>
                    <div className="text-[10px] text-stone-700">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">% ต้นทุน</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[85px]">
                    <div>ราคาที่ต้องตั้ง</div>
                    <div className="text-[10px] text-stone-600">ขาย (1.5x)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[85px]">
                    <div>ราคา</div>
                    <div className="text-[10px] text-stone-700">ตั้งเอง (บาท) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>ถูกหัก GP</div>
                    <div className="text-[10px] text-stone-600">({linemanGpPctDisplay}%)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>หลังหัก</div>
                    <div className="text-[10px] text-stone-600">เหลือ (บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>กำไรที่ได้</div>
                    <div className="text-[10px] text-stone-700">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 min-w-[65px]">% Margin</th>
                </>
              )}

              {/* ROBINHOOD COLUMNS */}
              {currentChannel === 'ROBINHOOD' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FAF8F5] text-stone-700 border-r border-black min-w-[75px]">
                    <div>ราคาหน้าร้าน</div>
                    <div className="text-[10px] text-stone-500">(อ้างอิง)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>น้ำหนักเนื้อที่ใช้</div>
                    <div className="text-[10px] text-stone-700">(กรัม / ตัว) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">
                    <div>ต้นทุนรวม</div>
                    <div className="text-[10px] text-stone-700">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">% ต้นทุน</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[85px]">
                    <div>ราคาที่ต้องตั้ง</div>
                    <div className="text-[10px] text-stone-600">ขาย (แนะนำ)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#EDE9FE] text-purple-900 border-r border-black min-w-[85px]">
                    <div>ราคา</div>
                    <div className="text-[10px] text-purple-700">ตั้งเอง (บาท) ✏️</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>ถูกหัก GP</div>
                    <div className="text-[10px] text-stone-600">(0% GP)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>หลังหัก</div>
                    <div className="text-[10px] text-stone-600">เหลือ (บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>กำไรที่ได้</div>
                    <div className="text-[10px] text-stone-700">(บาท)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 min-w-[65px]">% Margin</th>
                </>
              )}

              {/* ALL CHANNELS (Full 22 Columns) */}
              {currentChannel === 'ALL' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FFD54F] text-stone-900 border-r border-black min-w-[80px]">ราคาตั้งขาย</th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[80px]">น้ำหนักเนื้อ (g)</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">ต้นทุนเนื้อ</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">วัตถุดิบกลาง</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">วัตถุดิบรวม</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">ต้นทุนแฝง</th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[70px]">ต้นทุนรวม</th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[60px]">% ต้นทุน</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[70px]">กำไรที่ร้าน</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r-2 border-black min-w-[70px]">กำไรใส่กล่อง</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">Grab แนะนำ</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">Grab ตั้งเอง</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">หัก GP</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">หลังหัก</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r-2 border-black min-w-[65px]">กำไร Grab</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">Line Man แนะนำ</th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">LM ตั้งเอง</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">หัก GP</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">หลังหัก</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 min-w-[65px]">กำไร LM</th>
                </>
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-black/20 font-mono text-xs">
            {menu.variants.map((v, idx) => {
              const pName = (v.proteinType || v.name).toLowerCase();
              const isSeafood =
                v.proteinType?.includes('ทะเล') ||
                pName.includes('ทะเล') ||
                v.proteinType?.includes('ซีฟู้ด') ||
                pName.includes('ซีฟู้ด') ||
                (pName.includes('กุ้ง') && pName.includes('หมึก'));
              const editKey = `${v.id}_${currentServingMode}`;

              // Template defaults matching Excel template if not customized
              let baseSellingPrice = v.sellingPrice || 69;
              let baseWeight = 80;
              let baseGrabPrice = v.grabPrice || (v as any).grabPrice || v.deliveryPrice || 109;
              let baseLinemanPrice = v.linemanPrice || (v as any).linemanPrice || v.deliveryPrice || 109;
              let baseRobinhoodPrice = v.robinhoodPrice || (v as any).robinhoodPrice || baseSellingPrice;

              // Standard baseline defaults (applicable for both ON_RICE and A_LA_CARTE; all values user-editable)
              if (menu.name.includes('กะเพรา') || v.menuId === 'menu_kaprow') {
                if (pName.includes('หมูหมัก')) {
                  baseSellingPrice = v.sellingPrice === 65 ? 79 : v.sellingPrice;
                  baseWeight = 70;
                  baseGrabPrice = v.grabPrice || 109;
                  baseLinemanPrice = v.linemanPrice || 109;
                  baseRobinhoodPrice = v.robinhoodPrice || 79;
                } else if (pName.includes('หมูบด') || pName.includes('หมูสับ')) {
                  baseSellingPrice = v.sellingPrice === 60 ? 69 : v.sellingPrice;
                  baseWeight = 80;
                  baseGrabPrice = v.grabPrice || 109;
                  baseLinemanPrice = v.linemanPrice || 109;
                  baseRobinhoodPrice = v.robinhoodPrice || 69;
                } else if (pName.includes('ไก่')) {
                  baseSellingPrice = v.sellingPrice === 60 ? 69 : v.sellingPrice;
                  baseWeight = 80;
                  baseGrabPrice = v.grabPrice || 109;
                  baseLinemanPrice = v.linemanPrice || 109;
                  baseRobinhoodPrice = v.robinhoodPrice || 69;
                } else if (pName.includes('เนื้อวัวสไลซ์') || (pName.includes('เนื้อ') && !pName.includes('สับ') && v.sellingPrice <= 85)) {
                  baseSellingPrice = 129;
                  baseWeight = 120;
                  baseGrabPrice = v.grabPrice || 149;
                  baseLinemanPrice = v.linemanPrice || 149;
                  baseRobinhoodPrice = v.robinhoodPrice || 129;
                } else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) {
                  baseSellingPrice = 99;
                  baseWeight = 60;
                  baseGrabPrice = v.grabPrice || 149;
                  baseLinemanPrice = v.linemanPrice || 149;
                  baseRobinhoodPrice = v.robinhoodPrice || 99;
                } else if (pName.includes('กุ้ง')) {
                  baseSellingPrice = v.sellingPrice <= 85 ? 109 : v.sellingPrice;
                  baseWeight = 4;
                  baseGrabPrice = v.grabPrice || 139;
                  baseLinemanPrice = v.linemanPrice || 139;
                  baseRobinhoodPrice = v.robinhoodPrice || 109;
                } else if (pName.includes('หมึก') || pName.includes('ปลาหมึก')) {
                  baseSellingPrice = v.sellingPrice <= 85 ? 109 : v.sellingPrice;
                  baseWeight = 80;
                  baseGrabPrice = v.grabPrice || 139;
                  baseLinemanPrice = v.linemanPrice || 139;
                  baseRobinhoodPrice = v.robinhoodPrice || 109;
                } else if (isSeafood) {
                  baseSellingPrice = 129;
                  baseWeight = 80;
                  baseGrabPrice = 159;
                  baseLinemanPrice = 159;
                  baseRobinhoodPrice = 129;
                } else if (pName.includes('ไส้กรอก')) {
                  baseSellingPrice = 79;
                  baseWeight = 80;
                  baseGrabPrice = v.grabPrice || 119;
                  baseLinemanPrice = v.linemanPrice || 119;
                  baseRobinhoodPrice = v.robinhoodPrice || 79;
                }
              }

              // 1. Selling price at restaurant (USER EDITABLE)
              const sellingPrice =
                localEdits[editKey]?.sellingPrice !== undefined
                  ? localEdits[editKey]!.sellingPrice!
                  : (localEdits[v.id]?.sellingPrice !== undefined
                      ? localEdits[v.id]!.sellingPrice!
                      : baseSellingPrice);

              // 2. Find protein recipe item
              const proteinItem = (v.recipeItems || []).find((it) => {
                const lower = it.name.toLowerCase();
                return (
                  it.proteinCategory ||
                  lower.includes('หมู') ||
                  lower.includes('ไก่') ||
                  lower.includes('เนื้อ') ||
                  lower.includes('กุ้ง') ||
                  lower.includes('หมึก') ||
                  lower.includes('ไส้กรอก') ||
                  lower.includes('ปลา')
                );
              }) || (v.recipeItems && v.recipeItems[0]);

              // 3. Protein unit cost (per gram or per piece)
              let proteinUnitCost = proteinItem?.calculatedUnitCost || 0;
              if (!proteinUnitCost && proteinItem?.ingredientId) {
                const ing = ingredientsMap.get(proteinItem.ingredientId);
                if (ing) {
                  proteinUnitCost =
                    ing.costPerBaseUnit ||
                    ing.purchasePrice / (ing.purchaseQuantity * (ing.yieldPercent / 100));
                }
              }
              if (!proteinUnitCost) {
                // Look up matching ingredient from ingredientsMap by protein name
                for (const ing of ingredientsMap.values()) {
                  const ingLower = ing.name.toLowerCase();
                  if (
                    ingLower.includes(pName) ||
                    pName.includes(ingLower.split(' ')[0])
                  ) {
                    proteinUnitCost = ing.costPerBaseUnit || (ing.purchasePrice / (ing.purchaseQuantity * ((ing.yieldPercent || 100) / 100)));
                    break;
                  }
                }
              }
              if (!proteinUnitCost) {
                if (pName.includes('หมูหมัก')) proteinUnitCost = 0.214;
                else if (pName.includes('หมูบด') || pName.includes('หมูสับ')) proteinUnitCost = 0.113;
                else if (pName.includes('ไก่')) proteinUnitCost = 0.10;
                else if (pName.includes('เนื้อวัวสไลซ์') || pName.includes('เนื้อวัว สไลซ์')) proteinUnitCost = 0.40;
                else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) proteinUnitCost = 0.316;
                else if (pName.includes('กุ้ง')) proteinUnitCost = 8.5;
                else if (pName.includes('หมึก') || pName.includes('ปลาหมึก')) proteinUnitCost = 0.388;
                else if (pName.includes('ไส้กรอก')) proteinUnitCost = 0.138;
                else proteinUnitCost = 0.20;
              }

              // 4. Seafood dual quantities (กุ้ง และ หมึก) or single protein weight
              const shrimpItemFromRecipe = (v.recipeItems || []).find(
                (it) => it.proteinCategory === 'SHRIMP' || it.name.toLowerCase().includes('กุ้ง')
              );
              const squidItemFromRecipe = (v.recipeItems || []).find(
                (it) => it.proteinCategory === 'SQUID' || it.name.toLowerCase().includes('หมึก') || it.name.toLowerCase().includes('ปลาหมึก')
              );

              const defaultShrimp = shrimpItemFromRecipe?.quantity || 4;
              const defaultSquid = squidItemFromRecipe?.quantity || 40;

              const shrimpQty =
                localEdits[editKey]?.seafoodShrimpQty !== undefined
                  ? localEdits[editKey]!.seafoodShrimpQty!
                  : (localEdits[v.id]?.seafoodShrimpQty !== undefined
                      ? localEdits[v.id]!.seafoodShrimpQty!
                      : defaultShrimp);

              const squidQty =
                localEdits[editKey]?.seafoodSquidQty !== undefined
                  ? localEdits[editKey]!.seafoodSquidQty!
                  : (localEdits[v.id]?.seafoodSquidQty !== undefined
                      ? localEdits[v.id]!.seafoodSquidQty!
                      : defaultSquid);

              const shrimpUnitCost = shrimpItemFromRecipe?.calculatedUnitCost || 8.5; // บาท/ตัว
              const squidUnitCost = squidItemFromRecipe?.calculatedUnitCost || 0.388; // บาท/กรัม
              const shrimpTotalCost = Math.round(shrimpQty * shrimpUnitCost);
              const squidTotalCost = Math.round(squidQty * squidUnitCost);
              const seafoodCombinedCost = shrimpTotalCost + squidTotalCost;

              // 5. Protein weight used (USER EDITABLE)
              const proteinWeight =
                localEdits[editKey]?.proteinWeight !== undefined
                  ? localEdits[editKey]!.proteinWeight!
                  : (localEdits[v.id]?.proteinWeight !== undefined
                      ? localEdits[v.id]!.proteinWeight!
                      : (proteinItem?.quantity !== undefined && proteinItem.quantity !== 110
                          ? proteinItem.quantity
                          : baseWeight));

              // 6. Protein cost per dish (ราคาต้นทุนเนื้อ/จาน)
              // For seafood: combined total of shrimp and squid!
              const proteinCost = isSeafood ? seafoodCombinedCost : Math.round(proteinWeight * proteinUnitCost);

              // 7. Central ingredients cost (ต้นทุนวัตถุดิบกลาง)
              let sumCentral = 0;
              (v.recipeItems || []).forEach((it) => {
                const lower = it.name.toLowerCase();
                const isMeatOrSeafood =
                  it === proteinItem ||
                  (isSeafood && (lower.includes('กุ้ง') || lower.includes('หมึก') || it.proteinCategory === 'SHRIMP' || it.proteinCategory === 'SQUID'));
                if (!isMeatOrSeafood) {
                  // If in a la carte mode, skip rice
                  if (currentServingMode === 'A_LA_CARTE' && (lower.includes('ข้าว') || it.ingredientId === 'ing_cooked_rice')) {
                    return;
                  }
                  sumCentral += it.calculatedLineCost || it.quantity * (it.calculatedUnitCost || 0);
                }
              });
              const centralCost = sumCentral > 0 ? Math.round(sumCentral) : 22;

              // 8. Total raw material cost (ต้นทุนวัตถุดิบทั้งหมด)
              const totalRawMaterialCost = proteinCost + centralCost;

              // 9. Overhead & Packaging cost (ต้นทุนแฝง)
              let overheadCost = 28;
              if (pName.includes('หมูหมัก') || pName.includes('ไส้กรอก')) overheadCost = 32;
              else if (pName.includes('เนื้อวัวสไลซ์')) overheadCost = 52;
              else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) overheadCost = 40;
              else if (pName.includes('กุ้ง') || pName.includes('หมึก') || isSeafood) overheadCost = 44;
              else overheadCost = Math.round((v.overheadCost || 25) + (v.packagingCost || 7));

              // 10. Total cost (ต้นทุนรวม)
              const totalCost = totalRawMaterialCost + overheadCost;

              // 11. Food Cost %
              const fcPercent =
                sellingPrice > 0 ? Math.round((totalRawMaterialCost / sellingPrice) * 100) : 0;

              // 12. Profits at restaurant
              const packagingAmount = v.packagingCost || 9;
              const dineInProfit = Math.round(sellingPrice - totalCost + packagingAmount);
              const boxMarkup =
                v.takeawayPrice && v.sellingPrice && v.takeawayPrice > v.sellingPrice
                  ? v.takeawayPrice - v.sellingPrice
                  : 0;
              const effectiveTakeawayPrice = sellingPrice + boxMarkup;
              const takeawayProfit = Math.round(effectiveTakeawayPrice - totalCost);

              // 13-17. Grab Food calculations
              const grabSuggestedPrice = Number((sellingPrice * 1.5).toFixed(1));
              const grabPrice =
                localEdits[editKey]?.grabPrice !== undefined
                  ? localEdits[editKey]!.grabPrice!
                  : (localEdits[v.id]?.grabPrice !== undefined
                      ? localEdits[v.id]!.grabPrice!
                      : baseGrabPrice);
              const grabGpValue = Math.round(grabPrice * grabGpRateWithVat);
              const grabNet = grabPrice - grabGpValue;
              const grabProfit = grabNet - totalCost;
              const grabMargin = grabPrice > 0 ? Math.round((grabProfit / grabPrice) * 100) : 0;

              // 18-22. Line Man calculations
              const linemanSuggestedPrice = Number((sellingPrice * 1.5).toFixed(1));
              const linemanPrice =
                localEdits[editKey]?.linemanPrice !== undefined
                  ? localEdits[editKey]!.linemanPrice!
                  : (localEdits[v.id]?.linemanPrice !== undefined
                      ? localEdits[v.id]!.linemanPrice!
                      : baseLinemanPrice);
              const linemanGpValue = Math.round(linemanPrice * linemanGpRateWithVat);
              const linemanNet = linemanPrice - linemanGpValue;
              const linemanProfit = linemanNet - totalCost;
              const linemanMargin = linemanPrice > 0 ? Math.round((linemanProfit / linemanPrice) * 100) : 0;

              // 23-27. Robinhood calculations (0% GP)
              const robinhoodSuggestedPrice = sellingPrice; // Recommended same as dine-in
              const robinhoodPrice =
                localEdits[editKey]?.robinhoodPrice !== undefined
                  ? localEdits[editKey]!.robinhoodPrice!
                  : (localEdits[v.id]?.robinhoodPrice !== undefined
                      ? localEdits[v.id]!.robinhoodPrice!
                      : baseRobinhoodPrice);
              const robinhoodGpValue = 0; // 0% GP
              const robinhoodNet = robinhoodPrice - robinhoodGpValue;
              const robinhoodProfit = robinhoodNet - totalCost;
              const robinhoodMargin = robinhoodPrice > 0 ? Math.round((robinhoodProfit / robinhoodPrice) * 100) : 0;

              // Helper for rendering protein weight cell (single input or dual seafood input)
              const renderProteinWeightInput = (compact: boolean = false) => {
                if (isSeafood) {
                  return (
                    <div className="flex flex-col gap-1 items-center justify-center py-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-black text-amber-900 bg-amber-100 px-1 py-0.2 rounded border border-amber-300">
                          กุ้ง
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={shrimpQty}
                          onChange={(e) =>
                            handleSeafoodChange(v.id, 'shrimp', parseFloat(e.target.value) || 0)
                          }
                          className={`${compact ? 'w-10' : 'w-12'} px-1 py-0.5 text-center font-bold text-stone-900 bg-white border border-amber-400 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs font-mono`}
                          title="จำนวนกุ้ง (ตัว)"
                        />
                        <span className="text-[9px] text-stone-500">ตัว</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-black text-sky-900 bg-sky-100 px-1 py-0.2 rounded border border-sky-300">
                          หมึก
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={squidQty}
                          onChange={(e) =>
                            handleSeafoodChange(v.id, 'squid', parseFloat(e.target.value) || 0)
                          }
                          className={`${compact ? 'w-10' : 'w-12'} px-1 py-0.5 text-center font-bold text-stone-900 bg-white border border-sky-400 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono`}
                          title="น้ำหนักปลาหมึก (กรัม)"
                        />
                        <span className="text-[9px] text-stone-500">g</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <input
                    type="number"
                    min="0"
                    value={proteinWeight}
                    onChange={(e) =>
                      handleCellChange(v.id, 'proteinWeight', parseFloat(e.target.value) || 0)
                    }
                    className={`${compact ? 'w-14 px-1 py-0.5' : 'w-16 px-1.5 py-1'} text-center font-bold text-stone-900 bg-white border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono`}
                    title="น้ำหนักเนื้อที่ใช้ (กรัม / ตัว)"
                  />
                );
              };

              return (
                <tr
                  key={v.id}
                  draggable
                  onDragStart={(e) => handleVariantDragStart(e, v.id)}
                  onDragOver={(e) => handleVariantDragOver(e, v.id)}
                  onDrop={(e) => handleVariantDrop(e, v.id)}
                  onDragEnd={handleVariantDragEnd}
                  className={`transition-colors ${
                    draggedVariantId === v.id ? 'opacity-40 bg-stone-200' : ''
                  } ${
                    dragOverVariantId === v.id
                      ? 'border-t-2 border-[#F27D26] bg-amber-100/50'
                      : 'hover:bg-amber-50/40'
                  }`}
                >
                  {/* Common 0. ลำดับ พร้อมปุ่มลากย้าย & ลูกศร ขึ้น-ลง */}
                  <td className="py-1 px-1.5 bg-[#E53935] text-white font-extrabold border-r border-black select-none">
                    <div className="flex items-center justify-center gap-1">
                      <div
                        className="p-0.5 text-white/80 hover:text-white cursor-grab active:cursor-grabbing rounded hover:bg-black/20"
                        title="กดเมาส์ค้างไว้เพื่อลากย้ายลำดับเนื้อสัตว์"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-mono font-black text-xs min-w-[14px] text-center">{idx + 1}</span>
                      <div className="flex flex-col -space-y-0.5 ml-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveVariant(v.id, 'up');
                          }}
                          className="p-0.5 text-white/80 hover:text-white disabled:opacity-20 disabled:hover:text-white/80 rounded cursor-pointer transition-colors"
                          title="ย้ายขึ้น"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === menu.variants.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveVariant(v.id, 'down');
                          }}
                          className="p-0.5 text-white/80 hover:text-white disabled:opacity-20 disabled:hover:text-white/80 rounded cursor-pointer transition-colors"
                          title="ย้ายลง"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </td>

                  {/* Common 1. รายการ */}
                  <td className="py-2 px-3 bg-[#FFE0B2] text-stone-900 font-bold border-r border-black text-left whitespace-nowrap">
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-bold ${v.isOutOfStock ? 'line-through text-stone-500' : ''}`}>
                          {v.proteinType || v.name}
                        </span>
                        {(v.sku || v.code) && (
                          <span className="text-[10px] bg-stone-100 text-stone-700 px-1 py-0.2 rounded font-mono font-normal border border-stone-300" title={`รหัสเมนู POS / SKU: ${v.sku || v.code}`}>
                            #{v.sku || v.code}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleOutOfStock(v.id)}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-normal transition-colors cursor-pointer ${
                            v.isOutOfStock
                              ? 'bg-rose-100 text-rose-700 border border-rose-300 hover:bg-rose-200 font-bold'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-amber-100 hover:text-amber-800'
                          }`}
                          title={v.isOutOfStock ? 'คลิกเพื่อเปลี่ยนเป็น พร้อมขาย' : 'คลิกเพื่อแจ้ง วัตถุดิบหมด (POS จะปิดขาย)'}
                        >
                          {v.isOutOfStock ? '⚠️ ของหมด' : 'พร้อมขาย'}
                        </button>
                        {v.availableChannels && v.availableChannels.length > 0 && v.availableChannels.length < 4 && (
                          <span className="text-[9px] bg-amber-100/80 text-amber-900 px-1 py-0.2 rounded font-normal border border-amber-200" title={`ช่องทางที่ขาย: ${v.availableChannels.join(', ')}`}>
                            {v.availableChannels.map(c => c === 'DINE_IN' ? 'หน้าร้าน' : c === 'TAKEAWAY' ? 'กลับบ้าน' : c).join('·')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {onEditVariant && (
                          <button
                            type="button"
                            onClick={() => onEditVariant(menu, v)}
                            className="p-1 text-stone-600 hover:text-amber-800 hover:bg-amber-200/80 rounded cursor-pointer transition-colors"
                            title="แก้ไขตัวเลือกเนื้อสัตว์"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDeleteVariant && (
                          <button
                            type="button"
                            onClick={() => onDeleteVariant(menu, v.id)}
                            className="p-1 text-stone-600 hover:text-rose-600 hover:bg-rose-100 rounded cursor-pointer transition-colors"
                            title="ลบตัวเลือกเนื้อสัตว์"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onSelectBreakdown && (
                          <button
                            type="button"
                            onClick={() => {
                            const breakdown: RecipeCostBreakdown = {
                              variantId: v.id,
                              variantName: v.name,
                              menuName: menu.name,
                              proteinType: v.proteinType,
                              sellingPrice,
                              takeawayPrice: effectiveTakeawayPrice,
                              deliveryPrice: v.deliveryPrice || sellingPrice,
                              shrimpCost: isSeafood ? shrimpTotalCost : (v.proteinType.includes('กุ้ง') ? proteinCost : 0),
                              squidCost: isSeafood ? squidTotalCost : (v.proteinType.includes('หมึก') ? proteinCost : 0),
                              seafoodTotalCost: isSeafood ? seafoodCombinedCost : ((v.proteinType.includes('กุ้ง') || v.proteinType.includes('หมึก')) ? proteinCost : 0),
                              meatCost: proteinCost,
                              sauceCost: 3,
                              centralIngredientCost: centralCost,
                              totalIngredientCost: totalRawMaterialCost,
                              overheadCost,
                              packagingCost: packagingAmount,
                              totalCost,
                              restaurantProfit: dineInProfit,
                              restaurantFoodCostPercent: fcPercent,
                              restaurantMarginPercent: 100 - fcPercent,
                              takeawayProfit,
                              takeawayPackagingCost: packagingAmount,
                              takeawayFoodCostPercent: fcPercent,
                              deliveryCommissionPercent: 30,
                              deliveryCommissionAmount: grabGpValue,
                              deliveryPackagingCost: packagingAmount,
                              deliveryProfit: grabProfit,
                              deliveryFoodCostPercent: fcPercent,
                              suggestedPriceByTargetFoodCost: Math.round(totalRawMaterialCost / 0.35),
                              suggestedPriceByTargetProfit: Math.round(totalCost + 25),
                              hasReviewIssue: false,
                              items: v.recipeItems || [],
                            };
                            onSelectBreakdown({ menu, variant: v, breakdown });
                          }}
                          className="p-1 text-stone-500 hover:text-stone-900 rounded cursor-pointer"
                          title="ดูสูตรละเอียดและแพ็กเกจจิ้ง"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                        </button>
                      )}
                      </div>
                    </div>
                  </td>

                  {/* DINE_IN DATA CELLS */}
                  {currentChannel === 'DINE_IN' && (
                    <>
                      {/* ราคาตั้งขายที่ร้าน (EDITABLE) */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        <input
                          type="number"
                          min="0"
                          value={sellingPrice}
                          onChange={(e) =>
                            handleCellChange(v.id, 'sellingPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-16 px-1.5 py-1 text-center font-bold text-stone-900 bg-white border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
                        />
                      </td>

                      {/* น้ำหนักเนื้อที่ใช้ (EDITABLE) - แยก 2 ค่าสำหรับ 'ทะเล' */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>

                      {/* ราคาต้นทุนเนื้อ/จาน (รวมค่าเดียวสำหรับ 'ทะเล') */}
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">
                        <div className="text-stone-900 font-bold">{proteinCost}</div>
                        {isSeafood && (
                          <div className="text-[9px] text-stone-500 font-normal leading-tight">
                            กุ้ง {shrimpTotalCost} + หมึก {squidTotalCost}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{centralCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalRawMaterialCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{overheadCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td
                        className={`py-2 px-2 font-black border-r-2 border-black ${
                          fcPercent > 50
                            ? 'bg-rose-200 text-rose-950 font-black'
                            : fcPercent > 40
                            ? 'bg-amber-200 text-amber-950 font-black'
                            : 'bg-white text-stone-950 font-bold'
                        }`}
                      >
                        {fcPercent}%
                      </td>
                      <td className={`py-2 px-2 font-black border-r border-black ${
                        dineInProfit < 0 ? 'bg-rose-600 text-white' : 'bg-[#C8E6C9] text-stone-950'
                      }`}>
                        {dineInProfit}
                      </td>
                      <td className={`py-2 px-2 font-black ${
                        takeawayProfit < 0 ? 'bg-rose-600 text-white' : 'bg-[#C8E6C9] text-stone-950'
                      }`}>
                        {takeawayProfit}
                      </td>
                    </>
                  )}

                  {/* GRAB DATA CELLS */}
                  {currentChannel === 'GRAB' && (
                    <>
                      <td className="py-2 px-2 bg-[#FAF8F5] text-stone-600 font-bold border-r border-black">฿{sellingPrice}</td>
                      {/* น้ำหนักเนื้อที่ใช้ (EDITABLE) */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r-2 border-black">{fcPercent}%</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{grabSuggestedPrice}</td>

                      {/* Grab ราคาตั้งเอง (EDITABLE) */}
                      <td className="p-1 bg-white border-r border-black">
                        <input
                          type="number"
                          min="0"
                          value={grabPrice}
                          onChange={(e) =>
                            handleCellChange(v.id, 'grabPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-16 px-1.5 py-1 text-center font-bold text-stone-900 bg-[#E8F5E9] border border-green-400 rounded focus:outline-none focus:ring-2 focus:ring-green-600 text-xs font-mono"
                        />
                      </td>

                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{grabGpValue}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{grabNet}</td>
                      <td
                        className={`py-2 px-2 font-black border-r border-black ${
                          grabProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9] text-stone-900'
                        }`}
                      >
                        {grabProfit}
                      </td>
                      <td
                        className={`py-2 px-2 font-bold ${
                          grabMargin < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {grabMargin}%
                      </td>
                    </>
                  )}

                  {/* LINEMAN DATA CELLS */}
                  {currentChannel === 'LINEMAN' && (
                    <>
                      <td className="py-2 px-2 bg-[#FAF8F5] text-stone-600 font-bold border-r border-black">฿{sellingPrice}</td>
                      {/* น้ำหนักเนื้อที่ใช้ (EDITABLE) */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r-2 border-black">{fcPercent}%</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{linemanSuggestedPrice}</td>

                      {/* Line Man ราคาตั้งเอง (EDITABLE) */}
                      <td className="p-1 bg-white border-r border-black">
                        <input
                          type="number"
                          min="0"
                          value={linemanPrice}
                          onChange={(e) =>
                            handleCellChange(v.id, 'linemanPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-16 px-1.5 py-1 text-center font-bold text-stone-900 bg-[#FFF9C4] border border-amber-400 rounded focus:outline-none focus:ring-2 focus:ring-amber-600 text-xs font-mono"
                        />
                      </td>

                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{linemanGpValue}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{linemanNet}</td>
                      <td
                        className={`py-2 px-2 font-black border-r border-black ${
                          linemanProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9] text-stone-900'
                        }`}
                      >
                        {linemanProfit}
                      </td>
                      <td
                        className={`py-2 px-2 font-bold ${
                          linemanMargin < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {linemanMargin}%
                      </td>
                    </>
                  )}

                  {/* ROBINHOOD DATA CELLS */}
                  {currentChannel === 'ROBINHOOD' && (
                    <>
                      <td className="py-2 px-2 bg-[#FAF8F5] text-stone-600 font-bold border-r border-black">฿{sellingPrice}</td>
                      {/* น้ำหนักเนื้อที่ใช้ (EDITABLE) */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r-2 border-black">{fcPercent}%</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{robinhoodSuggestedPrice}</td>

                      {/* Robinhood ราคาตั้งเอง (EDITABLE) */}
                      <td className="p-1 bg-white border-r border-black">
                        <input
                          type="number"
                          min="0"
                          value={robinhoodPrice}
                          onChange={(e) =>
                            handleCellChange(v.id, 'robinhoodPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-16 px-1.5 py-1 text-center font-bold text-stone-900 bg-[#EDE9FE] border border-purple-400 rounded focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs font-mono"
                        />
                      </td>

                      <td className="py-2 px-2 bg-white text-emerald-700 font-bold border-r border-black">0</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{robinhoodNet}</td>
                      <td
                        className={`py-2 px-2 font-black border-r border-black ${
                          robinhoodProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9] text-stone-900'
                        }`}
                      >
                        {robinhoodProfit}
                      </td>
                      <td
                        className={`py-2 px-2 font-bold ${
                          robinhoodMargin < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {robinhoodMargin}%
                      </td>
                    </>
                  )}

                  {/* ALL CHANNELS (Full 22 Cells) */}
                  {currentChannel === 'ALL' && (
                    <>
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        <input
                          type="number"
                          min="0"
                          value={sellingPrice}
                          onChange={(e) =>
                            handleCellChange(v.id, 'sellingPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-14 px-1 py-0.5 text-center font-bold text-stone-900 bg-white border border-blue-400 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(true)}
                      </td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">
                        <div>{proteinCost}</div>
                        {isSeafood && (
                          <div className="text-[8px] text-stone-500 font-normal leading-tight">
                            กุ้ง{shrimpTotalCost}+หมึก{squidTotalCost}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{centralCost}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{totalRawMaterialCost}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{overheadCost}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className={`py-2 px-1.5 font-bold border-r-2 border-black ${fcPercent > 50 ? 'bg-[#FFB300] text-black' : 'bg-white'}`}>{fcPercent}%</td>
                      <td className="py-2 px-1.5 bg-[#C8E6C9] text-stone-900 font-bold border-r border-black">{dineInProfit}</td>
                      <td className="py-2 px-1.5 bg-[#C8E6C9] text-stone-900 font-bold border-r-2 border-black">{takeawayProfit}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{grabSuggestedPrice}</td>
                      <td className="p-1 bg-white border-r border-black">
                        <input
                          type="number"
                          min="0"
                          value={grabPrice}
                          onChange={(e) =>
                            handleCellChange(v.id, 'grabPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-14 px-1 py-0.5 text-center font-bold text-stone-900 bg-[#E8F5E9] border border-green-400 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{grabGpValue}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{grabNet}</td>
                      <td className={`py-2 px-1.5 font-black border-r-2 border-black ${grabProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9]'}`}>{grabProfit}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{linemanSuggestedPrice}</td>
                      <td className="p-1 bg-white border-r border-black">
                        <input
                          type="number"
                          min="0"
                          value={linemanPrice}
                          onChange={(e) =>
                            handleCellChange(v.id, 'linemanPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-14 px-1 py-0.5 text-center font-bold text-stone-900 bg-[#FFF9C4] border border-amber-400 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{linemanGpValue}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{linemanNet}</td>
                      <td className={`py-2 px-1.5 font-black ${linemanProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9]'}`}>{linemanProfit}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Notes per active channel */}
      <div className="bg-stone-50 border-t border-stone-200 px-4 py-2 flex flex-wrap items-center justify-between text-[11px] text-stone-500 font-medium">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-300 inline-block border border-blue-500"></span>
            <span>ช่องสีมีสัญลักษณ์ ✏️ พิมพ์ตัวเลขแก้ไขได้โดยตรง</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
            <span>สีแดง = กำไรติดลบ (Loss Alert)</span>
          </span>
        </div>
        <div className="text-[10px] text-stone-400">
          {currentChannel === 'DINE_IN' && 'แสดงเฉพาะรายการขายหน้าร้านและใส่กล่องกลับบ้าน'}
          {currentChannel === 'GRAB' && `คำนวณหัก GP Grab Food: ${grabCommissionBase}% + VAT 7% = ${grabGpPctDisplay}%`}
          {currentChannel === 'LINEMAN' && `คำนวณหัก GP Line Man: ${linemanCommissionBase}% + VAT 7% = ${linemanGpPctDisplay}%`}
          {currentChannel === 'ROBINHOOD' && 'คำนวณ Robinhood: 0% GP รับเงินเต็มจำนวน'}
          {currentChannel === 'ALL' && 'ตารางเปรียบเทียบทุกช่องทางพร้อมกัน'}
        </div>
      </div>
    </div>
  );
};
