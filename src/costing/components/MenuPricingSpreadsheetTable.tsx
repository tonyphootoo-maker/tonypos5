import React, { useState, useEffect, useRef } from 'react';
import {
  MenuItem,
  MenuVariant,
  Ingredient,
  Sauce,
  RestaurantSettings,
  RecipeCostBreakdown,
} from '../types';
import {
  calculateVariantCostBreakdown,
  calculateMultipliedChannelPrices,
  getDeliveryCommissionPercent,
  getEffectiveDeliveryGpPercent,
  getDeliveryPackagingCost,
} from '../services/calculationEngine';
import {
  resolveVariantBaseSellingPrice,
  resolveVariantTakeawayPrice,
  computeChannelPriceFromMultiplier,
} from '../services/spreadsheetCostHelper';
import { convertUnit } from '../engine/units';
import { extractNetPriceFromMenuPrice } from '../../engine/calculations';
import { Plus, SlidersHorizontal, Store, Bike, Smartphone, Flame, LayoutGrid, UtensilsCrossed, Edit2, Trash2, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { NumericInput } from './common/NumericInput';
import { getLocalizedText, localizeUnit } from '../../utils/thaiToEnglish';
import { useLanguage } from '../../contexts/LanguageContext';

export type PricingChannelTab = 'DINE_IN' | 'GRAB' | 'LINEMAN' | 'ROBINHOOD' | 'ALL';
export type ServingDishMode = 'ON_RICE' | 'A_LA_CARTE';

interface MenuPricingSpreadsheetTableProps {
  menu: MenuItem;
  ingredientsMap: Map<string, Ingredient>;
  saucesMap: Map<string, Sauce>;
  settings: RestaurantSettings;
  lang?: 'th' | 'en';
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
  lang: propLang,
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
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
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

  // Delivery GP rates & pricing config linked directly to restaurant settings
  const vatRate = settings.vatRatePercent ?? 7;
  const grabCommissionBase = getDeliveryCommissionPercent(settings, 'grab');
  const grabEffectiveGpPct = getEffectiveDeliveryGpPercent(settings, 'grab');
  const grabGpRateWithVat = grabEffectiveGpPct / 100;
  const grabGpPctDisplay = grabEffectiveGpPct.toFixed(2);

  const linemanCommissionBase = getDeliveryCommissionPercent(settings, 'lineman');
  const linemanEffectiveGpPct = getEffectiveDeliveryGpPercent(settings, 'lineman');
  const linemanGpRateWithVat = linemanEffectiveGpPct / 100;
  const linemanGpPctDisplay = linemanEffectiveGpPct.toFixed(2);
  const commissionHasVat = settings.commissionVatAsCost ?? settings.grabFoodCommissionHasVat ?? true;
  const grabMultiplier = Number(settings.grabPriceMultiplier) > 0 ? Number(settings.grabPriceMultiplier) : 1.5;
  const linemanMultiplier = Number(settings.linemanPriceMultiplier) > 0 ? Number(settings.linemanPriceMultiplier) : 1.5;
  const robinhoodMultiplier = Number(settings.robinhoodPriceMultiplier) > 0 ? Number(settings.robinhoodPriceMultiplier) : 1.0;

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
        takeawayPrice?: number;
        proteinWeight?: number;
        grabPrice?: number;
        linemanPrice?: number;
        robinhoodPrice?: number;
        seafoodShrimpQty?: number;
        seafoodSquidQty?: number;
      }
    >
  >({});

  // Sync or clear local channel price overrides in real time whenever header multipliers or external menu change
  const lastEmittedMenuRef = useRef<MenuItem | null>(null);
  const prevMultipliersRef = useRef({
    grab: grabMultiplier,
    lineman: linemanMultiplier,
    robinhood: robinhoodMultiplier,
  });

  useEffect(() => {
    if (menu !== lastEmittedMenuRef.current) {
      setLocalEdits({});
    }
  }, [menu]);

  useEffect(() => {
    const prevM = prevMultipliersRef.current;
    const grabChanged = prevM.grab !== grabMultiplier;
    const linemanChanged = prevM.lineman !== linemanMultiplier;
    const robinhoodChanged = prevM.robinhood !== robinhoodMultiplier;
    prevMultipliersRef.current = {
      grab: grabMultiplier,
      lineman: linemanMultiplier,
      robinhood: robinhoodMultiplier,
    };

    if (!grabChanged && !linemanChanged && !robinhoodChanged) return;

    setLocalEdits((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: typeof prev = {};
      for (const [k, entry] of Object.entries(prev)) {
        const updatedEntry = { ...entry };
        if (grabChanged) {
          if (updatedEntry.takeawayPrice !== undefined) {
            updatedEntry.grabPrice = computeChannelPriceFromMultiplier(
              updatedEntry.takeawayPrice,
              grabMultiplier
            );
          } else {
            delete updatedEntry.grabPrice;
          }
        }
        if (linemanChanged) {
          if (updatedEntry.takeawayPrice !== undefined) {
            updatedEntry.linemanPrice = computeChannelPriceFromMultiplier(
              updatedEntry.takeawayPrice,
              linemanMultiplier
            );
          } else {
            delete updatedEntry.linemanPrice;
          }
        }
        if (robinhoodChanged) {
          if (updatedEntry.takeawayPrice !== undefined) {
            updatedEntry.robinhoodPrice = computeChannelPriceFromMultiplier(
              updatedEntry.takeawayPrice,
              robinhoodMultiplier
            );
          } else {
            delete updatedEntry.robinhoodPrice;
          }
        }
        next[k] = updatedEntry;
      }
      return next;
    });
  }, [grabMultiplier, linemanMultiplier, robinhoodMultiplier]);

  const handleCellChange = (
    variantId: string,
    field: 'sellingPrice' | 'takeawayPrice' | 'proteinWeight' | 'grabPrice' | 'linemanPrice' | 'robinhoodPrice',
    val: number
  ) => {
    const editKey = `${variantId}_${currentServingMode}`;
    const targetVariant = menu.variants.find((item) => item.id === variantId);
    const existingBoxMarkup =
      targetVariant &&
      targetVariant.takeawayPrice !== undefined &&
      targetVariant.sellingPrice !== undefined &&
      targetVariant.takeawayPrice >= targetVariant.sellingPrice
        ? targetVariant.takeawayPrice - targetVariant.sellingPrice
        : 0;
    const computedTakeawayForSell = val > 0 ? val + existingBoxMarkup : 0;
    const multiplierBase =
      field === 'takeawayPrice'
        ? val
        : field === 'sellingPrice'
        ? computedTakeawayForSell
        : undefined;
    const multiplied =
      multiplierBase !== undefined
        ? calculateMultipliedChannelPrices(multiplierBase, {
            grabPriceMultiplier: grabMultiplier,
            linemanPriceMultiplier: linemanMultiplier,
            robinhoodPriceMultiplier: robinhoodMultiplier,
          })
        : null;
    const nextGrabPrice = multiplied ? multiplied.grabPrice : undefined;
    const nextLinemanPrice = multiplied ? multiplied.linemanPrice : undefined;
    const nextRobinhoodPrice = multiplied ? multiplied.robinhoodPrice : undefined;

    // 1. Update local state for immediate visual feedback
    setLocalEdits((prev) => ({
      ...prev,
      [editKey]: {
        ...prev[editKey],
        [field]: val,
        ...(field === 'sellingPrice'
          ? {
              takeawayPrice: computedTakeawayForSell,
              grabPrice: nextGrabPrice,
              linemanPrice: nextLinemanPrice,
              robinhoodPrice: nextRobinhoodPrice,
            }
          : {}),
        ...(field === 'takeawayPrice'
          ? {
              grabPrice: nextGrabPrice,
              linemanPrice: nextLinemanPrice,
              robinhoodPrice: nextRobinhoodPrice,
            }
          : {}),
      },
      // Keep base variantId synced for ON_RICE mode
      [variantId]: {
        ...prev[variantId],
        [field]: val,
        ...(field === 'sellingPrice'
          ? {
              takeawayPrice: computedTakeawayForSell,
              grabPrice: nextGrabPrice,
              linemanPrice: nextLinemanPrice,
              robinhoodPrice: nextRobinhoodPrice,
            }
          : {}),
        ...(field === 'takeawayPrice'
          ? {
              grabPrice: nextGrabPrice,
              linemanPrice: nextLinemanPrice,
              robinhoodPrice: nextRobinhoodPrice,
            }
          : {}),
      },
    }));

    // 2. Persist price changes immediately across all serving modes; proteinWeight persists in ON_RICE
    const isPriceField =
      field === 'sellingPrice' ||
      field === 'takeawayPrice' ||
      field === 'grabPrice' ||
      field === 'linemanPrice' ||
      field === 'robinhoodPrice';

    if (isPriceField || currentServingMode === 'ON_RICE') {
      const updatedVariants = menu.variants.map((v) => {
        if (v.id !== variantId) return v;

        if (field === 'sellingPrice') {
          const boxMarkup =
            v.takeawayPrice !== undefined && v.sellingPrice !== undefined && v.takeawayPrice >= v.sellingPrice
              ? v.takeawayPrice - v.sellingPrice
              : 0;
          const nextTakeaway = val > 0 ? val + boxMarkup : 0;
          return {
            ...v,
            sellingPrice: val,
            takeawayPrice: nextTakeaway,
            grabPrice: nextGrabPrice,
            linemanPrice: nextLinemanPrice,
            robinhoodPrice: nextRobinhoodPrice,
            deliveryPrice: nextGrabPrice ?? v.deliveryPrice,
          };
        }
        if (field === 'takeawayPrice') {
          return {
            ...v,
            takeawayPrice: val,
            grabPrice: nextGrabPrice,
            linemanPrice: nextLinemanPrice,
            robinhoodPrice: nextRobinhoodPrice,
            deliveryPrice: nextGrabPrice ?? v.deliveryPrice,
          };
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

      lastEmittedMenuRef.current = updatedMenu;
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
          <span
            className="px-3 py-1 !text-white font-black text-xs sm:text-sm rounded-lg shadow-xs tracking-wider flex items-center gap-1 border bg-rose-600 border-rose-700"
          >
            {lang === 'th' ? '🍚 จานเดียว / ราดข้าว' : '🍚 Single Plate / On Rice'}
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-stone-950 tracking-tight">
            {getLocalizedText(lang, menu.thaiName || menu.name, menu.englishName)}
          </h2>
          <span className="text-xs px-2 py-0.5 bg-stone-100 border border-stone-300 text-stone-700 rounded-md font-bold">
            {lang === 'th' ? `${menu.variants.length} ตัวเลือก` : `${menu.variants.length} options`}
          </span>
        </div>

        {/* Channel Selector Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-stone-200 p-1 rounded-xl border border-stone-300 shadow-2xs">
            {/* Dine-in */}
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
              <span>{lang === 'th' ? 'กินที่ร้าน' : 'Dine-in'}</span>
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

            {/* All Channels */}
            <button
              type="button"
              onClick={() => handleSelectChannel('ALL')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                currentChannel === 'ALL'
                  ? 'bg-stone-900 !text-white shadow-xs'
                  : 'text-stone-800 hover:text-stone-950 font-bold hover:bg-stone-300'
              }`}
              title={lang === 'th' ? 'เปรียบเทียบทุกช่องทางพร้อมกัน' : 'Compare all channels side-by-side'}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{lang === 'th' ? 'แสดงทั้งหมด' : 'Show All'}</span>
            </button>
          </div>

          {onOpenAddVariant && (
            <button
              type="button"
              onClick={() => onOpenAddVariant(menu)}
              className="px-3 py-1.5 bg-[#F27D26] hover:bg-[#d96817] !text-white font-black text-xs rounded-xl shadow-xs flex items-center gap-1 cursor-pointer transition-colors border border-[#c2580e]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'th' ? '+ เพิ่มตัวเลือก' : '+ Add Option'}</span>
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
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">
                    {lang === 'th' ? 'ข้อมูลเมนู' : 'Menu Info'}
                  </th>
                  <th colSpan={9} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">
                    {lang === 'th' ? 'ต้นทุนวัตถุดิบ & การตั้งราคาหน้าร้าน' : 'Ingredient Cost & Dine-In Pricing'}
                  </th>
                  <th colSpan={2} className="bg-cyan-700 !text-white font-black py-1.5 tracking-wide">
                    {lang === 'th' ? 'กำไรหน้าร้าน' : 'Storefront Profit'}
                  </th>
                </>
              )}

              {currentChannel === 'GRAB' && (
                <>
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">
                    {lang === 'th' ? 'ข้อมูลเมนู' : 'Menu Info'}
                  </th>
                  <th colSpan={4} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">
                    {lang === 'th' ? 'ต้นทุนอ้างอิง' : 'Cost Reference'}
                  </th>
                  <th colSpan={6} className="bg-[#00873e] !text-white font-black py-1.5 tracking-wide">
                    {lang === 'th' ? `Grab Food (GP ${grabGpPctDisplay}% รวม VAT)` : `Grab Food (GP ${grabGpPctDisplay}% incl. VAT)`}
                  </th>
                </>
              )}

              {currentChannel === 'LINEMAN' && (
                <>
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">
                    {lang === 'th' ? 'ข้อมูลเมนู' : 'Menu Info'}
                  </th>
                  <th colSpan={4} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">
                    {lang === 'th' ? 'ต้นทุนอ้างอิง' : 'Cost Reference'}
                  </th>
                  <th colSpan={6} className="bg-[#FFB300] text-stone-950 font-black py-1.5 tracking-wide">
                    {lang === 'th' ? `Line Man (GP ${linemanGpPctDisplay}% รวม VAT)` : `Line Man (GP ${linemanGpPctDisplay}% incl. VAT)`}
                  </th>
                </>
              )}

              {currentChannel === 'ROBINHOOD' && (
                <>
                  <th colSpan={2} className="bg-[#FAF8F5] border-r border-black py-1 font-bold text-stone-900">
                    {lang === 'th' ? 'ข้อมูลเมนู' : 'Menu Info'}
                  </th>
                  <th colSpan={4} className="bg-[#FFF9C4] text-stone-950 font-black border-r border-black py-1">
                    {lang === 'th' ? 'ต้นทุนอ้างอิง' : 'Cost Reference'}
                  </th>
                  <th colSpan={6} className="bg-[#6d28d9] !text-white font-black py-1.5 tracking-wide">
                    Robinhood (0% GP)
                  </th>
                </>
              )}

              {currentChannel === 'ALL' && (
                <>
                  <th colSpan={10} className="bg-[#FAF8F5] border-r border-black py-1"></th>
                  <th colSpan={12} className="bg-[#FFFF00] text-stone-950 text-sm font-black py-1.5 border-b border-black tracking-wide">
                    {lang === 'th' ? 'กำไรแต่ละรายการ' : 'Profit Per Item'}
                  </th>
                </>
              )}
            </tr>

            {/* Header Tier 2: Sub-banners if ALL channels */}
            {currentChannel === 'ALL' && (
              <tr className="text-xs font-bold select-none border-b border-black">
                <th colSpan={10} className="bg-[#FAF8F5] border-r border-black"></th>
                <th colSpan={2} className="bg-cyan-700 !text-white font-black py-1 border-r border-black">
                  {lang === 'th' ? 'ที่ร้าน' : 'In-Store'}
                </th>
                <th colSpan={5} className="bg-[#00873e] !text-white font-black py-1 border-r border-black">Grab Food</th>
                <th colSpan={5} className="bg-[#FFB300] text-stone-950 font-black py-1">Line Man</th>
              </tr>
            )}

            {/* Header Tier 3: Detailed Column Headers per Active Channel */}
            <tr className="text-[11px] font-bold text-stone-900 border-b-2 border-black whitespace-nowrap">
              {/* Common Columns */}
              <th className="py-2.5 px-2 bg-[#E53935] text-white border-r border-black min-w-[70px]">
                {lang === 'th' ? 'ลำดับ' : 'Order'}
              </th>
              <th className="py-2.5 px-3 bg-[#90CAF9] text-stone-900 border-r border-black text-left min-w-[120px]">
                {lang === 'th' ? 'รายการ' : 'Item'}
              </th>

              {/* DINE_IN COLUMNS */}
              {currentChannel === 'DINE_IN' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FFD54F] text-stone-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาตั้งขาย' : 'Selling Price'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? 'ที่ร้าน (บาท) ✏️' : 'Dine-in (฿) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFE082] text-stone-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาใส่กล่อง' : 'Takeaway Price'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(Takeaway) ✏️' : '(Box) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>{lang === 'th' ? 'น้ำหนักเนื้อที่ใช้' : 'Protein Weight'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(กรัม / ตัว) ✏️' : '(g / pc) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[80px]">
                    <div>{lang === 'th' ? 'ราคาต้นทุน' : 'Protein Cost'}</div>
                    <div className="text-[10px] text-stone-600">
                      {lang === 'th' ? <><span className="text-rose-600 font-bold">เนื้อ</span>/จาน</> : <><span className="text-rose-600 font-bold">Meat</span>/plate</>}
                    </div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ต้นทุนวัตถุดิบ' : 'Base Recipe'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? 'กลาง (บาท)' : 'Cost (฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ต้นทุนวัตถุดิบ' : 'Total Raw'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? 'ทั้งหมด (บาท)' : 'Material (฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">
                    <div>{lang === 'th' ? 'ต้นทุนแฝง' : 'Hidden Cost'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[70px]">
                    <div>{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">
                    {lang === 'th' ? '% ต้นทุน' : '% Cost'}
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'กำไร' : 'Profit'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? 'กินที่ร้าน (บาท)' : 'Dine-in (฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 min-w-[75px]">
                    <div>{lang === 'th' ? 'กำไร' : 'Profit'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? 'ใส่กล่อง (บาท)' : 'Takeaway (฿)'}</div>
                  </th>
                </>
              )}

              {/* GRAB COLUMNS */}
              {currentChannel === 'GRAB' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FAF8F5] text-stone-700 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาใส่กล่อง' : 'Takeaway Price'}</div>
                    <div className="text-[10px] text-stone-500">{lang === 'th' ? '(ฐานคำนวณ)' : '(Base)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>{lang === 'th' ? 'น้ำหนักเนื้อที่ใช้' : 'Protein Weight'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(กรัม / ตัว) ✏️' : '(g / pc) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">
                    {lang === 'th' ? '% ต้นทุน' : '% Cost'}
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาที่ต้องตั้ง' : 'Suggested'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? `ขาย (${grabMultiplier}x)` : `Price (${grabMultiplier}x)`}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคา' : 'Custom'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? 'ตั้งเอง (บาท) ✏️' : 'Price (฿) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ถูกหัก GP ไป' : 'GP Fee'}</div>
                    <div className="text-[10px] text-stone-600">({grabGpPctDisplay}%)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'หลังหัก' : 'Net Payout'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? 'เหลือ (บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'กำไรที่ได้' : 'Net Profit'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 min-w-[65px]">% Margin</th>
                </>
              )}

              {/* LINEMAN COLUMNS */}
              {currentChannel === 'LINEMAN' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FAF8F5] text-stone-700 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาใส่กล่อง' : 'Takeaway Price'}</div>
                    <div className="text-[10px] text-stone-500">{lang === 'th' ? '(ฐานคำนวณ)' : '(Base)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>{lang === 'th' ? 'น้ำหนักเนื้อที่ใช้' : 'Protein Weight'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(กรัม / ตัว) ✏️' : '(g / pc) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">
                    {lang === 'th' ? '% ต้นทุน' : '% Cost'}
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาที่ต้องตั้ง' : 'Suggested'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? `ขาย (${linemanMultiplier}x)` : `Price (${linemanMultiplier}x)`}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคา' : 'Custom'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? 'ตั้งเอง (บาท) ✏️' : 'Price (฿) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ถูกหัก GP' : 'GP Fee'}</div>
                    <div className="text-[10px] text-stone-600">({linemanGpPctDisplay}%)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'หลังหัก' : 'Net Payout'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? 'เหลือ (บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'กำไรที่ได้' : 'Net Profit'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 min-w-[65px]">% Margin</th>
                </>
              )}

              {/* ROBINHOOD COLUMNS */}
              {currentChannel === 'ROBINHOOD' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FAF8F5] text-stone-700 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาใส่กล่อง' : 'Takeaway Price'}</div>
                    <div className="text-[10px] text-stone-500">{lang === 'th' ? '(ฐานคำนวณ)' : '(Base)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[105px]">
                    <div>{lang === 'th' ? 'น้ำหนักเนื้อที่ใช้' : 'Protein Weight'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(กรัม / ตัว) ✏️' : '(g / pc) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[65px]">
                    {lang === 'th' ? '% ต้นทุน' : '% Cost'}
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคาที่ต้องตั้ง' : 'Suggested'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? `ขาย (${robinhoodMultiplier}x)` : `Price (${robinhoodMultiplier}x)`}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#EDE9FE] text-purple-900 border-r border-black min-w-[85px]">
                    <div>{lang === 'th' ? 'ราคา' : 'Custom'}</div>
                    <div className="text-[10px] text-purple-700">{lang === 'th' ? 'ตั้งเอง (บาท) ✏️' : 'Price (฿) ✏️'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'ถูกหัก GP' : 'GP Fee'}</div>
                    <div className="text-[10px] text-stone-600">(0% GP)</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'หลังหัก' : 'Net Payout'}</div>
                    <div className="text-[10px] text-stone-600">{lang === 'th' ? 'เหลือ (บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">
                    <div>{lang === 'th' ? 'กำไรที่ได้' : 'Net Profit'}</div>
                    <div className="text-[10px] text-stone-700">{lang === 'th' ? '(บาท)' : '(฿)'}</div>
                  </th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 min-w-[65px]">% Margin</th>
                </>
              )}

              {/* ALL CHANNELS (Full 22 Columns) */}
              {currentChannel === 'ALL' && (
                <>
                  <th className="py-2.5 px-2 bg-[#FFD54F] text-stone-900 border-r border-black min-w-[80px]">{lang === 'th' ? 'ราคาตั้งขาย' : 'Price'}</th>
                  <th className="py-2.5 px-2 bg-[#BBDEFB] text-stone-900 border-r border-black min-w-[80px]">{lang === 'th' ? 'น้ำหนักเนื้อ (g)' : 'Protein (g)'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">{lang === 'th' ? 'ต้นทุนเนื้อ' : 'Meat Cost'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">{lang === 'th' ? 'วัตถุดิบกลาง' : 'Base Cost'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[70px]">{lang === 'th' ? 'วัตถุดิบรวม' : 'Raw Total'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">{lang === 'th' ? 'ต้นทุนแฝง' : 'Overhead'}</th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[70px]">{lang === 'th' ? 'ต้นทุนรวม' : 'Total Cost'}</th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r-2 border-black min-w-[60px]">{lang === 'th' ? '% ต้นทุน' : '% Cost'}</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[70px]">{lang === 'th' ? 'กำไรที่ร้าน' : 'Dine-in Profit'}</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r-2 border-black min-w-[70px]">{lang === 'th' ? 'กำไรใส่กล่อง' : 'Takeaway Profit'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">{lang === 'th' ? 'Grab แนะนำ' : 'Grab Sugg.'}</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r border-black min-w-[75px]">{lang === 'th' ? 'Grab ตั้งเอง' : 'Grab Price'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">{lang === 'th' ? 'หัก GP' : 'GP Fee'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">{lang === 'th' ? 'หลังหัก' : 'Net'}</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 border-r-2 border-black min-w-[65px]">{lang === 'th' ? 'กำไร Grab' : 'Grab Profit'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[75px]">{lang === 'th' ? 'Line Man แนะนำ' : 'LM Sugg.'}</th>
                  <th className="py-2.5 px-2 bg-[#FFF59D] text-stone-900 border-r border-black min-w-[75px]">{lang === 'th' ? 'LM ตั้งเอง' : 'LM Price'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">{lang === 'th' ? 'หัก GP' : 'GP Fee'}</th>
                  <th className="py-2.5 px-2 bg-white text-stone-900 border-r border-black min-w-[65px]">{lang === 'th' ? 'หลังหัก' : 'Net'}</th>
                  <th className="py-2.5 px-2 bg-[#C8E6C9] text-stone-900 min-w-[65px]">{lang === 'th' ? 'กำไร LM' : 'LM Profit'}</th>
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

              // Canonical Dine-in & Takeaway prices (no hardcoded channel overrides)
              const baseSellingPrice = resolveVariantBaseSellingPrice(menu, v);
              const baseTakeawayPrice = resolveVariantTakeawayPrice(menu, v);
              let baseWeight = 80;

              if (menu.name.includes('กะเพรา') || v.menuId === 'menu_kaprow') {
                if (pName.includes('หมูหมัก')) {
                  baseWeight = 70;
                } else if (pName.includes('หมูบด') || pName.includes('หมูสับ')) {
                  baseWeight = 80;
                } else if (pName.includes('ไก่')) {
                  baseWeight = 80;
                } else if (pName.includes('เนื้อวัวสไลซ์') || (pName.includes('เนื้อ') && !pName.includes('สับ'))) {
                  baseWeight = 120;
                } else if (pName.includes('เนื้อวัว สับ') || pName.includes('เนื้อสับ')) {
                  baseWeight = 60;
                } else if (pName.includes('กุ้ง') && !isSeafood) {
                  baseWeight = 4;
                } else if ((pName.includes('หมึก') || pName.includes('ปลาหมึก')) && !isSeafood) {
                  baseWeight = 80;
                } else if (isSeafood) {
                  baseWeight = 80;
                } else if (pName.includes('ไส้กรอก')) {
                  baseWeight = 80;
                }
              }

              const baseGrabPrice =
                typeof v.grabPrice === 'number' && v.grabPrice > 0
                  ? v.grabPrice
                  : computeChannelPriceFromMultiplier(baseTakeawayPrice, grabMultiplier);
              const baseLinemanPrice =
                typeof v.linemanPrice === 'number' && v.linemanPrice > 0
                  ? v.linemanPrice
                  : computeChannelPriceFromMultiplier(baseTakeawayPrice, linemanMultiplier);
              const baseRobinhoodPrice =
                typeof v.robinhoodPrice === 'number' && v.robinhoodPrice > 0
                  ? v.robinhoodPrice
                  : computeChannelPriceFromMultiplier(baseTakeawayPrice, robinhoodMultiplier);

              // 1. Selling price at restaurant & Takeaway price (USER EDITABLE)
              const sellingPrice =
                localEdits[editKey]?.sellingPrice !== undefined
                  ? localEdits[editKey]!.sellingPrice!
                  : (localEdits[v.id]?.sellingPrice !== undefined
                      ? localEdits[v.id]!.sellingPrice!
                      : baseSellingPrice);
              const takeawayPrice =
                localEdits[editKey]?.takeawayPrice !== undefined
                  ? localEdits[editKey]!.takeawayPrice!
                  : (localEdits[v.id]?.takeawayPrice !== undefined
                      ? localEdits[v.id]!.takeawayPrice!
                      : baseTakeawayPrice);

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

              const shrimpUnitCost = shrimpItemFromRecipe?.calculatedUnitCost
                ?? ingredientsMap.get(shrimpItemFromRecipe?.ingredientId || 'ing_shrimp_xl')?.costPerBaseUnit
                ?? 0;
              const squidUnitCost = squidItemFromRecipe?.calculatedUnitCost
                ?? ingredientsMap.get(squidItemFromRecipe?.ingredientId || 'ing_squid_fresh')?.costPerBaseUnit
                ?? 0;
              const shrimpTotalCost = shrimpQty * shrimpUnitCost;
              const squidTotalCost = squidQty * squidUnitCost;
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

              // 6. Protein cost per dish (full precision)
              const proteinCostNum = isSeafood ? seafoodCombinedCost : proteinWeight * proteinUnitCost;

              // 7. Central ingredients cost (converted units, skip rice in a la carte mode, zero magic fallback)
              let sumCentral = 0;
              const effectiveRecipeItems = (v.recipeItems || []).map((it) => {
                if (currentServingMode === 'A_LA_CARTE') {
                  const lower = it.name.toLowerCase();
                  if (lower.includes('ข้าว') || it.ingredientId === 'ing_cooked_rice') {
                    return { ...it, quantity: 0 };
                  }
                }
                if (it === proteinItem && !isSeafood) {
                  return { ...it, quantity: proteinWeight };
                }
                if (isSeafood && (it.proteinCategory === 'SHRIMP' || it.name.toLowerCase().includes('กุ้ง'))) {
                  return { ...it, quantity: shrimpQty };
                }
                if (isSeafood && (it.proteinCategory === 'SQUID' || it.name.toLowerCase().includes('หมึก'))) {
                  return { ...it, quantity: squidQty };
                }
                return it;
              });

              effectiveRecipeItems.forEach((it) => {
                const lower = it.name.toLowerCase();
                const isMeatOrSeafood =
                  it === proteinItem ||
                  (isSeafood && (lower.includes('กุ้ง') || lower.includes('หมึก') || it.proteinCategory === 'SHRIMP' || it.proteinCategory === 'SQUID'));
                if (!isMeatOrSeafood && it.quantity > 0) {
                  const ing = ingredientsMap.get(it.ingredientId);
                  if (ing) {
                    const conv = convertUnit(it.quantity, it.unit || ing.usageUnit || ing.baseUnit, ing.usageUnit || ing.baseUnit);
                    sumCentral += conv.success ? conv.convertedQuantity * ing.costPerBaseUnit : 0;
                  } else if (it.ingredientType === 'SAUCE') {
                    const sc = saucesMap.get(it.ingredientId);
                    if (sc && sc.actualQuantity > 0) {
                      const conv = convertUnit(it.quantity, it.unit || sc.productionUnit || 'g', sc.productionUnit || 'g');
                      sumCentral += conv.success ? conv.convertedQuantity * sc.costPerGram : 0;
                    } else {
                      sumCentral += it.calculatedLineCost || it.quantity * (it.calculatedUnitCost || 0);
                    }
                  } else {
                    sumCentral += it.calculatedLineCost || it.quantity * (it.calculatedUnitCost || 0);
                  }
                }
              });

              // Resolved channel prices (real-time local edits or multiplied stored values)
              const grabPrice =
                localEdits[editKey]?.grabPrice !== undefined
                  ? localEdits[editKey]!.grabPrice!
                  : (localEdits[v.id]?.grabPrice !== undefined
                      ? localEdits[v.id]!.grabPrice!
                      : baseGrabPrice);
              const linemanPrice =
                localEdits[editKey]?.linemanPrice !== undefined
                  ? localEdits[editKey]!.linemanPrice!
                  : (localEdits[v.id]?.linemanPrice !== undefined
                      ? localEdits[v.id]!.linemanPrice!
                      : baseLinemanPrice);
              const robinhoodPrice =
                localEdits[editKey]?.robinhoodPrice !== undefined
                  ? localEdits[editKey]!.robinhoodPrice!
                  : (localEdits[v.id]?.robinhoodPrice !== undefined
                      ? localEdits[v.id]!.robinhoodPrice!
                      : baseRobinhoodPrice);

              // Canonical breakdown from calculationEngine (zero magic fallbacks, clean separation of packaging)
              const editedVariant: MenuVariant = {
                ...v,
                sellingPrice,
                grabPrice,
                linemanPrice,
                robinhoodPrice,
                deliveryPrice: grabPrice,
                recipeItems: effectiveRecipeItems,
              };
              const grabBd = calculateVariantCostBreakdown(
                { ...editedVariant, deliveryPrice: grabPrice },
                menu.name,
                ingredientsMap,
                saucesMap,
                settings,
                'grab'
              );
              const linemanBd = calculateVariantCostBreakdown(
                { ...editedVariant, deliveryPrice: linemanPrice },
                menu.name,
                ingredientsMap,
                saucesMap,
                settings,
                'lineman'
              );

              const proteinCost = Number(proteinCostNum.toFixed(2));
              const centralCost = Number(sumCentral.toFixed(2));
              const totalRawMaterialCost = Number((proteinCostNum + sumCentral).toFixed(2));
              const overheadCostNum = grabBd.overheadCost;
              const overheadCost = Number(overheadCostNum.toFixed(2));
              // Dine-in total cost excludes packaging
              const totalCostNum = totalRawMaterialCost + overheadCostNum;
              const totalCost = Number(totalCostNum.toFixed(2));

              const isVariantVatInclusive =
                v.taxType === 'INCLUSIVE' ||
                (v.taxType !== 'EXCLUSIVE' &&
                  v.taxType !== 'NONE' &&
                  Boolean(settings.pricesIncludeVat ?? settings.salesVatInclusive));
              const scIncluded = Boolean(settings.serviceChargeIncludedInPrice);
              const scRate = settings.serviceChargePercent ?? 0;
              const netDineInPrice = extractNetPriceFromMenuPrice(
                sellingPrice,
                isVariantVatInclusive,
                vatRate,
                scIncluded,
                scRate
              );

              // 11. Food Cost % (food only / net selling price ex-VAT)
              const fcPercent =
                netDineInPrice > 0 ? Number(((totalRawMaterialCost / netDineInPrice) * 100).toFixed(1)) : 0;

              // 12. Profits at restaurant (dine-in has 0 packaging; takeaway adds packaging)
              const packagingAmount =
                (grabBd.packagingCost || 0) > 0
                  ? grabBd.packagingCost
                  : (settings.takeawayPackagingCost ?? 0);
              const deliveryPkgAmount =
                (grabBd.packagingCost || 0) > 0
                  ? grabBd.packagingCost
                  : getDeliveryPackagingCost(settings, 'grab');

              const dineInProfit = Number((netDineInPrice - totalCostNum).toFixed(2));
              const effectiveTakeawayPrice = takeawayPrice;
              const netTakeawayPrice = extractNetPriceFromMenuPrice(
                effectiveTakeawayPrice,
                isVariantVatInclusive,
                vatRate,
                scIncluded,
                scRate
              );
              const takeawayProfit = Number((netTakeawayPrice - totalCostNum - packagingAmount).toFixed(2));

              // 13-17. Grab Food calculations (multiplier-based suggested price from Takeaway + effective GP + packaging)
              const grabSuggestedPrice = computeChannelPriceFromMultiplier(effectiveTakeawayPrice, grabMultiplier);
              const grabNetSelling = extractNetPriceFromMenuPrice(
                grabPrice,
                isVariantVatInclusive,
                vatRate,
                scIncluded,
                scRate
              );
              const grabGpValueNum = grabPrice * grabGpRateWithVat;
              const grabGpValue = Number(grabGpValueNum.toFixed(2));
              const grabNet = Number((grabNetSelling - grabGpValueNum).toFixed(2));
              const grabProfit = Number((grabNetSelling - grabGpValueNum - totalCostNum - deliveryPkgAmount).toFixed(2));
              const grabMargin = grabNetSelling > 0 ? Number(((grabProfit / grabNetSelling) * 100).toFixed(1)) : 0;

              // 18-22. Line Man calculations
              const linemanSuggestedPrice = computeChannelPriceFromMultiplier(effectiveTakeawayPrice, linemanMultiplier);
              const linemanNetSelling = extractNetPriceFromMenuPrice(
                linemanPrice,
                isVariantVatInclusive,
                vatRate,
                scIncluded,
                scRate
              );
              const linemanGpValueNum = linemanPrice * linemanGpRateWithVat;
              const linemanGpValue = Number(linemanGpValueNum.toFixed(2));
              const linemanNet = Number((linemanNetSelling - linemanGpValueNum).toFixed(2));
              const linemanProfit = Number((linemanNetSelling - linemanGpValueNum - totalCostNum - deliveryPkgAmount).toFixed(2));
              const linemanMargin = linemanNetSelling > 0 ? Number(((linemanProfit / linemanNetSelling) * 100).toFixed(1)) : 0;

              // 23-27. Robinhood calculations (0% GP)
              const robinhoodSuggestedPrice = computeChannelPriceFromMultiplier(effectiveTakeawayPrice, robinhoodMultiplier);
              const robinhoodNetSelling = extractNetPriceFromMenuPrice(
                robinhoodPrice,
                isVariantVatInclusive,
                vatRate,
                scIncluded,
                scRate
              );
              const robinhoodNet = Number(robinhoodNetSelling.toFixed(2));
              const robinhoodProfit = Number((robinhoodNetSelling - totalCostNum - deliveryPkgAmount).toFixed(2));
              const robinhoodMargin = robinhoodNetSelling > 0 ? Number(((robinhoodProfit / robinhoodNetSelling) * 100).toFixed(1)) : 0;

              // Helper for rendering protein weight cell (single input or dual seafood input)
              const renderProteinWeightInput = (compact: boolean = false) => {
                if (isSeafood) {
                  return (
                    <div className="flex flex-col gap-1 items-center justify-center py-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-black text-amber-900 bg-amber-100 px-1 py-0.2 rounded border border-amber-300">
                          {lang === 'th' ? 'กุ้ง' : 'Shrimp'}
                        </span>
                        <NumericInput
                          min="0"
                          value={shrimpQty}
                          onValueChange={(val) =>
                            handleSeafoodChange(v.id, 'shrimp', val)
                          }
                          className={`${compact ? 'w-10' : 'w-12'} px-1 py-0.5 text-center font-bold text-stone-900 bg-white border border-amber-400 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs font-mono`}
                          title={lang === 'th' ? 'จำนวนกุ้ง (ตัว)' : 'Shrimp count (pcs)'}
                        />
                        <span className="text-[9px] text-stone-500">{localizeUnit('ตัว', lang)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-black text-sky-900 bg-sky-100 px-1 py-0.2 rounded border border-sky-300">
                          {lang === 'th' ? 'หมึก' : 'Squid'}
                        </span>
                        <NumericInput
                          min="0"
                          value={squidQty}
                          onValueChange={(val) =>
                            handleSeafoodChange(v.id, 'squid', val)
                          }
                          className={`${compact ? 'w-10' : 'w-12'} px-1 py-0.5 text-center font-bold text-stone-900 bg-white border border-sky-400 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono`}
                          title={lang === 'th' ? 'น้ำหนักปลาหมึก (กรัม)' : 'Squid weight (g)'}
                        />
                        <span className="text-[9px] text-stone-500">g</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <NumericInput
                    min="0"
                    value={proteinWeight}
                    onValueChange={(val) =>
                      handleCellChange(v.id, 'proteinWeight', val)
                    }
                    className={`${compact ? 'w-14 px-1 py-0.5' : 'w-16 px-1.5 py-1'} text-center font-bold text-stone-900 bg-white border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono`}
                    title={lang === 'th' ? 'น้ำหนักเนื้อที่ใช้ (กรัม / ตัว)' : 'Protein weight used (g / pc)'}
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
                  {/* Common 0. Order */}
                  <td className="py-1 px-1.5 bg-[#E53935] text-white font-extrabold border-r border-black select-none">
                    <div className="flex items-center justify-center gap-1">
                      <div
                        className="p-0.5 text-white/80 hover:text-white cursor-grab active:cursor-grabbing rounded hover:bg-black/20"
                        title={lang === 'th' ? 'กดเมาส์ค้างไว้เพื่อลากย้ายลำดับเนื้อสัตว์' : 'Drag to reorder'}
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
                          title={lang === 'th' ? 'ย้ายขึ้น' : 'Move up'}
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
                          title={lang === 'th' ? 'ย้ายลง' : 'Move down'}
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </td>

                  {/* Common 1. Item */}
                  <td className="py-2 px-3 bg-[#FFE0B2] text-stone-900 font-bold border-r border-black text-left whitespace-nowrap">
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-bold ${v.isOutOfStock ? 'line-through text-stone-500' : ''}`}>
                          {getLocalizedText(lang, v.thaiName || v.proteinType || v.name, v.englishName)}
                        </span>
                        {(v.sku || v.code) && (
                          <span className="text-[10px] bg-stone-100 text-stone-700 px-1 py-0.2 rounded font-mono font-normal border border-stone-300" title={`POS SKU: ${v.sku || v.code}`}>
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
                          title={
                            v.isOutOfStock
                              ? (lang === 'th' ? 'คลิกเพื่อเปลี่ยนเป็น พร้อมขาย' : 'Click to mark Available')
                              : (lang === 'th' ? 'คลิกเพื่อแจ้ง วัตถุดิบหมด (POS จะปิดขาย)' : 'Click to mark Out of Stock')
                          }
                        >
                          {v.isOutOfStock ? (lang === 'th' ? '⚠️ ของหมด' : '⚠️ Out of Stock') : (lang === 'th' ? 'พร้อมขาย' : 'Available')}
                        </button>
                        {v.availableChannels && v.availableChannels.length > 0 && v.availableChannels.length < 4 && (
                          <span className="text-[9px] bg-amber-100/80 text-amber-900 px-1 py-0.2 rounded font-normal border border-amber-200" title={`${lang === 'th' ? 'ช่องทางที่ขาย:' : 'Channels:'} ${v.availableChannels.join(', ')}`}>
                            {v.availableChannels.map(c => c === 'DINE_IN' ? (lang === 'th' ? 'หน้าร้าน' : 'Dine-in') : c === 'TAKEAWAY' ? (lang === 'th' ? 'กลับบ้าน' : 'Takeaway') : c).join('·')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {onEditVariant && (
                          <button
                            type="button"
                            onClick={() => onEditVariant(menu, v)}
                            className="p-1 text-stone-600 hover:text-amber-800 hover:bg-amber-200/80 rounded cursor-pointer transition-colors"
                            title={lang === 'th' ? 'แก้ไขตัวเลือก' : 'Edit option'}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDeleteVariant && (
                          <button
                            type="button"
                            onClick={() => onDeleteVariant(menu, v.id)}
                            className="p-1 text-stone-600 hover:text-rose-600 hover:bg-rose-100 rounded cursor-pointer transition-colors"
                            title={lang === 'th' ? 'ลบตัวเลือกเนื้อสัตว์' : 'Delete option'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onSelectBreakdown && (
                          <button
                            type="button"
                            onClick={() => {
                            const activeBd = currentChannel === 'LINEMAN' ? linemanBd : grabBd;
                            onSelectBreakdown({ menu, variant: editedVariant, breakdown: activeBd });
                          }}
                          className="p-1 text-stone-500 hover:text-stone-900 rounded cursor-pointer"
                          title={lang === 'th' ? 'ดูสูตรละเอียดและแพ็กเกจจิ้ง' : 'View recipe & packaging breakdown'}
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
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        <NumericInput
                          min="0"
                          value={sellingPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'sellingPrice', val)
                          }
                          className="w-16 px-1.5 py-1 text-center font-bold text-stone-900 bg-white border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
                        />
                      </td>
                      <td className="p-1 bg-[#FFF8E1] border-r border-black">
                        <NumericInput
                          min="0"
                          value={takeawayPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'takeawayPrice', val)
                          }
                          className="w-16 px-1.5 py-1 text-center font-bold text-stone-900 bg-white border border-amber-400 rounded focus:outline-none focus:ring-2 focus:ring-amber-600 text-xs font-mono"
                        />
                      </td>

                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>

                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">
                        <div className="text-stone-900 font-bold">{proteinCost}</div>
                        {isSeafood && (
                          <div className="text-[9px] text-stone-500 font-normal leading-tight">
                            {lang === 'th' ? `กุ้ง ${shrimpTotalCost.toFixed(1)} + หมึก ${squidTotalCost.toFixed(1)}` : `Shrimp ${shrimpTotalCost.toFixed(1)} + Squid ${squidTotalCost.toFixed(1)}`}
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
                      <td className="py-2 px-2 bg-[#FAF8F5] text-stone-600 font-bold border-r border-black">฿{effectiveTakeawayPrice}</td>
                      {/* น้ำหนักเนื้อที่ใช้ (EDITABLE) */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r-2 border-black">{fcPercent}%</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{grabSuggestedPrice}</td>

                      {/* Grab ราคาตั้งเอง (EDITABLE) */}
                      <td className="p-1 bg-white border-r border-black">
                        <NumericInput
                          min="0"
                          value={grabPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'grabPrice', val)
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
                      <td className="py-2 px-2 bg-[#FAF8F5] text-stone-600 font-bold border-r border-black">฿{effectiveTakeawayPrice}</td>
                      {/* น้ำหนักเนื้อที่ใช้ (EDITABLE) */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r-2 border-black">{fcPercent}%</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{linemanSuggestedPrice}</td>

                      {/* Line Man ราคาตั้งเอง (EDITABLE) */}
                      <td className="p-1 bg-white border-r border-black">
                        <NumericInput
                          min="0"
                          value={linemanPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'linemanPrice', val)
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
                      <td className="py-2 px-2 bg-[#FAF8F5] text-stone-600 font-bold border-r border-black">฿{effectiveTakeawayPrice}</td>
                      {/* น้ำหนักเนื้อที่ใช้ (EDITABLE) */}
                      <td className="p-1 bg-[#BBDEFB] border-r border-black">
                        {renderProteinWeightInput(false)}
                      </td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r-2 border-black">{fcPercent}%</td>
                      <td className="py-2 px-2 bg-white text-stone-900 font-bold border-r border-black">{robinhoodSuggestedPrice}</td>

                      {/* Robinhood ราคาตั้งเอง (EDITABLE) */}
                      <td className="p-1 bg-white border-r border-black">
                        <NumericInput
                          min="0"
                          value={robinhoodPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'robinhoodPrice', val)
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
                        <NumericInput
                          min="0"
                          value={sellingPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'sellingPrice', val)
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
                            {lang === 'th' ? `กุ้ง${shrimpTotalCost.toFixed(1)}+หมึก${squidTotalCost.toFixed(1)}` : `Shr${shrimpTotalCost.toFixed(1)}+Sq${squidTotalCost.toFixed(1)}`}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{centralCost}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{totalRawMaterialCost}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{overheadCost}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{totalCost}</td>
                      <td className={`py-2 px-1.5 font-bold border-r-2 border-black ${fcPercent > 50 ? 'bg-[#FFB300] text-black' : 'bg-white'}`}>{fcPercent}%</td>
                      <td className={`py-2 px-1.5 font-bold border-r border-black ${dineInProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9] text-stone-900'}`}>{dineInProfit}</td>
                      <td className={`py-2 px-1.5 font-bold border-r-2 border-black ${takeawayProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9] text-stone-900'}`}>{takeawayProfit}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{grabSuggestedPrice}</td>
                      <td className="p-1 bg-white border-r border-black">
                        <NumericInput
                          min="0"
                          value={grabPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'grabPrice', val)
                          }
                          className="w-14 px-1 py-0.5 text-center font-bold text-stone-900 bg-[#E8F5E9] border border-green-400 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{grabGpValue}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{grabNet}</td>
                      <td className={`py-2 px-1.5 font-black border-r-2 border-black ${grabProfit < 0 ? 'bg-[#E53935] text-white' : 'bg-[#C8E6C9]'}`}>{grabProfit}</td>
                      <td className="py-2 px-1.5 bg-white text-stone-900 font-bold border-r border-black">{linemanSuggestedPrice}</td>
                      <td className="p-1 bg-white border-r border-black">
                        <NumericInput
                          min="0"
                          value={linemanPrice}
                          onValueChange={(val) =>
                            handleCellChange(v.id, 'linemanPrice', val)
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
            <span>
              {lang === 'th' ? 'ช่องสีมีสัญลักษณ์ ✏️ พิมพ์ตัวเลขแก้ไขได้โดยตรง' : 'Highlighted cells with ✏️ are directly editable'}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
            <span>{lang === 'th' ? 'สีแดง = กำไรติดลบ (Loss Alert)' : 'Red = Negative Profit (Loss Alert)'}</span>
          </span>
        </div>
        <div className="text-[10px] text-stone-400">
          {currentChannel === 'DINE_IN' && (lang === 'th' ? 'แสดงเฉพาะรายการขายหน้าร้าน (ไม่รวมกล่อง) และใส่กล่องกลับบ้าน' : 'Shows Storefront Dine-in (excl. box) & Takeaway')}
          {currentChannel === 'GRAB' && `${lang === 'th' ? 'คำนวณหัก GP Grab Food' : 'Grab Food GP'}: ${grabCommissionBase}%${commissionHasVat ? ` + VAT ${vatRate}%` : ''} = ${grabGpPctDisplay}%`}
          {currentChannel === 'LINEMAN' && `${lang === 'th' ? 'คำนวณหัก GP Line Man' : 'Line Man GP'}: ${linemanCommissionBase}%${commissionHasVat ? ` + VAT ${vatRate}%` : ''} = ${linemanGpPctDisplay}%`}
          {currentChannel === 'ROBINHOOD' && (lang === 'th' ? 'คำนวณ Robinhood: 0% GP รับเงินเต็มจำนวน' : 'Robinhood: 0% GP (100% payout)')}
          {currentChannel === 'ALL' && (lang === 'th' ? 'ตารางเปรียบเทียบทุกช่องทางพร้อมกัน' : 'Side-by-side multi-channel comparison')}
        </div>
      </div>
    </div>
  );
};
