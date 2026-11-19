import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Search,
  RefreshCw,
  Trash2,
  X,
  ClipboardCheck,
  History,
  Info,
} from 'lucide-react';
import {
  InventoryItem,
  InventoryTransaction,
  WasteRecord,
  Ingredient,
  StockCountSnapshot,
  StockCountItem,
} from '../types';
import { convertUnitQuantity } from '../services/transactionService';
import { NumericInput } from './common/NumericInput';
import { CategoryIngredientSelect } from './common/CategoryIngredientSelect';
import { getLocalizedText, localizeUnit } from '../../utils/thaiToEnglish';
import { useLanguage } from '../../contexts/LanguageContext';

interface InventoryViewProps {
  inventory: InventoryItem[];
  ingredients: Ingredient[];
  transactions: InventoryTransaction[];
  wasteLog: WasteRecord[];
  stockCounts?: StockCountSnapshot[];
  lang?: 'th' | 'en';
  onSaveAdjustment: (txn: InventoryTransaction, waste?: WasteRecord) => void;
  onSaveStockCount?: (snapshot: StockCountSnapshot, adjustments: InventoryTransaction[]) => void;
}

const AP_RECOUNT_ADVISORY_KEY = 'tonys_ap_recount_advisory_dismissed_v1';

export function resolveInventoryApUnitCost(item: InventoryItem, ing?: Ingredient): number {
  if (ing && ing.purchasePrice > 0) {
    if (ing.usageUnit === 'ตัว' && ing.piecesPerPurchaseUnit && ing.piecesPerPurchaseUnit > 0) {
      return ing.purchasePrice / ing.piecesPerPurchaseUnit;
    }
    const pQty = ing.purchaseQuantity > 0 ? ing.purchaseQuantity : 0;
    if (pQty > 0) {
      const qtyInInvUnit = convertUnitQuantity(pQty, ing.purchaseUnit, item.unit);
      if (qtyInInvUnit > 0) {
        return ing.purchasePrice / qtyInInvUnit;
      }
    }
  }
  if (typeof item.costPerUnit === 'number' && Number.isFinite(item.costPerUnit) && item.costPerUnit > 0) {
    return item.costPerUnit;
  }
  if (ing && ing.costPerBaseUnit > 0) {
    const yieldRatio = ing.yieldPercent > 0 ? ing.yieldPercent / 100 : 1;
    return ing.costPerBaseUnit * yieldRatio;
  }
  return 0;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  inventory,
  ingredients,
  transactions,
  wasteLog,
  stockCounts = [],
  lang: propLang,
  onSaveAdjustment,
  onSaveStockCount,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const [activeTab, setActiveTab] = useState<'STOCK' | 'SNAPSHOTS' | 'TRANSACTIONS' | 'WASTE'>('STOCK');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);

  // Period Closing Stock Count Modal state
  const [isStockCountModalOpen, setIsStockCountModalOpen] = useState(false);
  const [countDate, setCountDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [countNotes, setCountNotes] = useState<string>('');
  const [countedQuantities, setCountedQuantities] = useState<Record<string, number>>({});
  const [isAdvisoryDismissed, setIsAdvisoryDismissed] = useState<boolean>(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(AP_RECOUNT_ADVISORY_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Adjustment Modal state
  const [selectedItemId, setSelectedItemId] = useState<string>(inventory[0]?.id || '');
  const [adjustType, setAdjustType] = useState<'ADJUSTMENT' | 'WASTE' | 'PURCHASE'>('ADJUSTMENT');
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState<string>('');

  const ingredientsMap = useMemo(
    () => new Map<string, Ingredient>(ingredients.map((i) => [i.id, i])),
    [ingredients]
  );

  const getIngDisplayName = (ingredientId: string, fallbackName: string) => {
    const ing = ingredientsMap.get(ingredientId);
    return getLocalizedText(lang, ing?.thaiName || ing?.name || fallbackName, ing?.englishName);
  };

  const inventoryWithCategories = useMemo(() => {
    return inventory.map((item) => {
      const ing = ingredientsMap.get(item.ingredientId);
      return {
        ...item,
        name: item.ingredientName,
        thaiName: ing?.thaiName || ing?.name || item.ingredientName,
        englishName: ing?.englishName,
        category: item.category || ing?.category || 'ของแห้งและเบ็ดเตล็ด',
      };
    });
  }, [inventory, ingredientsMap]);

  const filteredInventory = inventory.filter((item) => {
    const q = searchTerm.toLowerCase();
    const displayName = getIngDisplayName(item.ingredientId, item.ingredientName).toLowerCase();
    return item.ingredientName.toLowerCase().includes(q) || displayName.includes(q);
  });

  const lowStockItems = inventory.filter((item) => item.currentStock <= item.minStock);

  const sortedSnapshots = useMemo(
    () =>
      [...stockCounts].sort((a, b) => {
        const d = b.date.localeCompare(a.date);
        if (d !== 0) return d;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }),
    [stockCounts]
  );

  const handleOpenAdjust = (item?: InventoryItem) => {
    if (item) setSelectedItemId(item.id || item.ingredientId);
    setAdjustQuantity(0);
    setAdjustReason('');
    setIsAdjustModalOpen(true);
  };

  const handleOpenStockCount = () => {
    const initialQty: Record<string, number> = {};
    for (const item of inventory) {
      initialQty[item.ingredientId] = Number(item.currentStock ?? item.currentQuantity ?? 0);
    }
    setCountedQuantities(initialQty);
    setCountDate(new Date().toISOString().slice(0, 10));
    setCountNotes('');
    setIsStockCountModalOpen(true);
  };

  const stockCountPreviewItems = useMemo<StockCountItem[]>(() => {
    return inventory.map((item) => {
      const ing = ingredientsMap.get(item.ingredientId);
      const qty = Math.max(0, Number(countedQuantities[item.ingredientId] ?? item.currentStock ?? 0) || 0);
      const unitCost = resolveInventoryApUnitCost(item, ing);
      return {
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        countedQty: qty,
        unit: item.unit,
        costPerUnit: unitCost,
        totalValue: qty * unitCost,
      };
    });
  }, [inventory, ingredientsMap, countedQuantities]);

  const stockCountTotalValue = useMemo(
    () => stockCountPreviewItems.reduce((sum, it) => sum + it.totalValue, 0),
    [stockCountPreviewItems]
  );

  const handleConfirmStockCount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveStockCount) {
      setIsStockCountModalOpen(false);
      return;
    }

    const nowIso = new Date().toISOString();
    const snapshot: StockCountSnapshot = {
      id: `sc_${Date.now()}`,
      date: countDate || nowIso.slice(0, 10),
      totalValue: Math.round((stockCountTotalValue + Number.EPSILON) * 100) / 100,
      items: stockCountPreviewItems,
      notes: countNotes.trim() || undefined,
      createdAt: nowIso,
      countedBy: 'Manager',
    };

    const adjustments: InventoryTransaction[] = [];
    for (const item of inventory) {
      const prevQty = Number(item.currentStock ?? item.currentQuantity ?? 0);
      const nextQty = Math.max(0, Number(countedQuantities[item.ingredientId] ?? prevQty) || 0);
      const delta = nextQty - prevQty;
      if (Math.abs(delta) > 0.0001) {
        const unitCost = resolveInventoryApUnitCost(item, ingredientsMap.get(item.ingredientId));
        adjustments.push({
          id: `txn_sc_${Date.now()}_${item.ingredientId}`,
          inventoryItemId: item.id,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          type: 'STOCK_COUNT',
          quantity: delta,
          quantityChange: delta,
          resultingQuantity: nextQty,
          unit: item.unit,
          date: snapshot.date,
          reason: lang === 'th' ? `นับสต็อกปิดงวด (${snapshot.date})` : `Period stock count (${snapshot.date})`,
          notes: snapshot.notes,
          user: 'Manager',
          cost: Math.abs(delta) * unitCost,
          referenceId: snapshot.id,
        });
      }
    }

    onSaveStockCount(snapshot, adjustments);
    setIsStockCountModalOpen(false);
    setActiveTab('SNAPSHOTS');
  };

  const handleSaveAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    const item = inventory.find((i) => i.id === selectedItemId || i.ingredientId === selectedItemId);
    if (!item) return;

    const ing = ingredientsMap.get(item.ingredientId);
    const unitCost = resolveInventoryApUnitCost(item, ing);
    const totalCost = Math.abs(adjustQuantity) * unitCost;

    const txn: InventoryTransaction = {
      id: `txn_${Date.now()}`,
      inventoryItemId: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      type: adjustType,
      quantity: adjustQuantity,
      unit: item.unit,
      date: new Date().toISOString().slice(0, 10),
      reason: adjustReason || (lang === 'th' ? 'ปรับปรุงยอดสต็อกหน้าร้าน' : 'Manual stock adjustment'),
      user: 'Manager',
      cost: totalCost,
    };

    let wasteItem: WasteRecord | undefined;
    if (adjustType === 'WASTE') {
      wasteItem = {
        id: `waste_${Date.now()}`,
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        quantity: Math.abs(adjustQuantity),
        unit: item.unit,
        cost: totalCost,
        totalCost,
        reason: adjustReason || (lang === 'th' ? 'ของเสียระหว่างเตรียม' : 'Prep waste'),
        date: new Date().toISOString().slice(0, 10),
        user: 'Manager',
      };
    }

    onSaveAdjustment(txn, wasteItem);
    setIsAdjustModalOpen(false);
  };

  const handleDismissAdvisory = () => {
    setIsAdvisoryDismissed(true);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AP_RECOUNT_ADVISORY_KEY, '1');
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          {lang === 'th' ? 'ระบบคลังสินค้าและของเสีย (Inventory & Stock Control)' : 'Inventory & Stock Control'}
        </h1>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleOpenStockCount}
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>{lang === 'th' ? 'นับสต็อกปิดงวด' : 'Period Stock Count'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenAdjust()}
            className="px-4 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{lang === 'th' ? 'ปรับยอดสต็อก / ตัดของเสีย' : 'Adjust Stock / Record Waste'}</span>
          </button>
        </div>
      </div>

      {/* Advisory Banner for AP Stock Deduction & Recount */}
      {!isAdvisoryDismissed && (
        <div className="p-4 bg-sky-500/10 rounded-2xl border border-sky-400/30 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-sky-500/20 text-sky-300 rounded-xl shrink-0">
              <Info className="w-4 h-4" />
            </div>
            <div className="text-xs text-sky-100 leading-relaxed">
              <strong className="text-white block">
                {lang === 'th'
                  ? 'คำแนะนำหลังปรับระบบตัดสต็อกเป็นวัตถุดิบดิบ (AP) ตาม Yield'
                  : 'Advisory: AP Yield-Adjusted Stock Deduction Active'}
              </strong>
              <span>
                {lang === 'th' ? (
                  <>
                    ระบบได้อัปเกรดการตัดสต็อกให้หักรวมส่วนสูญเสียจากการเตรียม (EP ÷ Yield%) เพื่อความแม่นยำ แต่ไม่ได้แก้ยอดคงเหลือเดิมย้อนหลัง แนะนำให้กด{' '}
                    <button
                      type="button"
                      onClick={handleOpenStockCount}
                      className="underline font-bold text-emerald-300 hover:text-emerald-200 cursor-pointer"
                    >
                      นับสต็อกใหม่หนึ่งครั้ง
                    </button>{' '}
                    เพื่อใช้เป็นฐานสต็อกต้นงวดที่ถูกต้องสำหรับงบ P&amp;L
                  </>
                ) : (
                  <>
                    Stock deduction now accounts for prep trim loss (EP ÷ Yield%) for accuracy without rewriting historical balances. Please run a{' '}
                    <button
                      type="button"
                      onClick={handleOpenStockCount}
                      className="underline font-bold text-emerald-300 hover:text-emerald-200 cursor-pointer"
                    >
                      fresh stock count
                    </button>{' '}
                    to establish an accurate opening stock baseline for your P&amp;L.
                  </>
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismissAdvisory}
            className="p-1 text-white/40 hover:text-white cursor-pointer shrink-0"
            title={lang === 'th' ? 'ปิดข้อความแนะนำ' : 'Dismiss advisory'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Low Stock Warning Banner */}
      {lowStockItems.length > 0 && (
        <div className="p-4 bg-[#FFC107]/10 rounded-2xl border border-[#FFC107]/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#FFC107] text-black rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white text-xs">
                {lang === 'th'
                  ? `แจ้งเตือน: มีวัตถุดิบ ${lowStockItems.length} รายการ ต่ำกว่าระดับสต็อกปลอดภัย`
                  : `Alert: ${lowStockItems.length} ingredient(s) below safety stock`}
              </h4>
              <p className="text-[11px] text-[#FFC107] mt-0.5">
                {lowStockItems
                  .map(
                    (i) =>
                      `${getIngDisplayName(i.ingredientId, i.ingredientName)} (${i.currentStock} ${localizeUnit(i.unit, lang)})`
                  )
                  .join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('STOCK')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'STOCK'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          {lang === 'th' ? `ยอดคงเหลือปัจจุบัน (${inventory.length})` : `Current Stock (${inventory.length})`}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('SNAPSHOTS')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'SNAPSHOTS'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>
            {lang === 'th'
              ? `บันทึกนับสต็อกปิดงวด (${stockCounts.length})`
              : `Stock Count Snapshots (${stockCounts.length})`}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('TRANSACTIONS')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'TRANSACTIONS'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          {lang === 'th'
            ? `ประวัติการเคลื่อนไหวสต็อก (${transactions.length})`
            : `Stock Movements (${transactions.length})`}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('WASTE')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'WASTE'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>
            {lang === 'th' ? `บันทึกของเสีย (Waste Log) (${wasteLog.length})` : `Waste Log (${wasteLog.length})`}
          </span>
        </button>
      </div>

      {/* TAB 1: CURRENT STOCK */}
      {activeTab === 'STOCK' && (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="relative w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                placeholder={lang === 'th' ? 'ค้นหาสต็อก...' : 'Search stock...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-black/30 border border-white/10 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-[#F27D26]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">{lang === 'th' ? 'วัตถุดิบ' : 'Ingredient'}</th>
                  <th className="py-3 px-3 text-right">{lang === 'th' ? 'สต็อกคงเหลือ' : 'On Hand'}</th>
                  <th className="py-3 px-3 text-right">{lang === 'th' ? 'สต็อกขั้นต่ำ' : 'Min Stock'}</th>
                  <th className="py-3 px-3 text-right">{lang === 'th' ? 'สต็อกแนะนำ' : 'Par / Max'}</th>
                  <th className="py-3 px-3 text-center">{lang === 'th' ? 'สถานะ' : 'Status'}</th>
                  <th className="py-3 px-4 text-right">{lang === 'th' ? 'ปรับยอด' : 'Adjust'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {filteredInventory.map((item) => {
                  const isLow = item.currentStock <= item.minStock;
                  const unitLabel = localizeUnit(item.unit, lang);
                  return (
                    <tr key={item.id} className="hover:bg-white/5">
                      <td className="py-3.5 px-4 font-sans font-bold text-white">
                        {getIngDisplayName(item.ingredientId, item.ingredientName)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-bold text-white text-sm">
                        {item.currentStock.toLocaleString()} {unitLabel}
                      </td>
                      <td className="py-3.5 px-3 text-right text-white/40">
                        {item.minStock} {unitLabel}
                      </td>
                      <td className="py-3.5 px-3 text-right text-white/40">
                        {item.maxStock} {unitLabel}
                      </td>
                      <td className="py-3.5 px-3 text-center font-sans">
                        {isLow ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFC107]/20 text-[#FFC107] border border-[#FFC107]/30">
                            {lang === 'th' ? 'สต็อกต่ำ' : 'Low Stock'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                            {lang === 'th' ? 'ปกติ' : 'Normal'}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => handleOpenAdjust(item)}
                          className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer border border-white/10"
                        >
                          {lang === 'th' ? 'ปรับยอด' : 'Adjust'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 1.5: STOCK COUNT SNAPSHOTS */}
      {activeTab === 'SNAPSHOTS' && (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
          {sortedSnapshots.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-xs space-y-2">
              <p>{lang === 'th' ? 'ยังไม่มีบันทึกนับสต็อกปิดงวด' : 'No period stock count snapshots yet'}</p>
              <button
                type="button"
                onClick={handleOpenStockCount}
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-xl text-xs cursor-pointer"
              >
                {lang === 'th' ? 'นับสต็อกปิดงวดครั้งแรก' : 'Record First Stock Count'}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">{lang === 'th' ? 'วันที่ปิดงวด' : 'Count Date'}</th>
                    <th className="py-3 px-3 text-right">{lang === 'th' ? 'จำนวนรายการ' : 'Items'}</th>
                    <th className="py-3 px-3 text-right">{lang === 'th' ? 'มูลค่าสต็อกรวม (THB)' : 'Total Value (THB)'}</th>
                    <th className="py-3 px-3">{lang === 'th' ? 'หมายเหตุ' : 'Notes'}</th>
                    <th className="py-3 px-4">{lang === 'th' ? 'บันทึกโดย' : 'Counted By'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {sortedSnapshots.map((snap) => (
                    <tr key={snap.id} className="hover:bg-white/5">
                      <td className="py-3 px-4 font-bold text-emerald-400">{snap.date}</td>
                      <td className="py-3 px-3 text-right text-white/80">
                        {snap.items?.length || 0}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-white text-sm">
                        ฿{snap.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 font-sans text-white/60">
                        {snap.notes ? getLocalizedText(lang, snap.notes) : '-'}
                      </td>
                      <td className="py-3 px-4 font-sans text-white/40">
                        {snap.countedBy ? getLocalizedText(lang, snap.countedBy) : (lang === 'en' ? 'Manager' : 'ผู้จัดการ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: TRANSACTIONS */}
      {activeTab === 'TRANSACTIONS' && (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
          {transactions.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-xs">
              {lang === 'th' ? 'ยังไม่มีประวัติการปรับปรุงสต็อก' : 'No stock movement history yet'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">{lang === 'th' ? 'วันที่' : 'Date'}</th>
                    <th className="py-3 px-3">{lang === 'th' ? 'ประเภท' : 'Type'}</th>
                    <th className="py-3 px-3">{lang === 'th' ? 'วัตถุดิบ' : 'Ingredient'}</th>
                    <th className="py-3 px-3 text-right">{lang === 'th' ? 'จำนวน' : 'Qty'}</th>
                    <th className="py-3 px-3">{lang === 'th' ? 'เหตุผล' : 'Reason'}</th>
                    <th className="py-3 px-4">{lang === 'th' ? 'ผู้บันทึก' : 'User'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-white/5">
                      <td className="py-3 px-4 font-sans text-white/60">{t.date}</td>
                      <td className="py-3 px-3 font-sans">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.type === 'PURCHASE'
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : t.type === 'WASTE'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : t.type === 'STOCK_COUNT'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-white/10 text-white/80 border border-white/10'
                          }`}
                        >
                          {t.type === 'PURCHASE'
                            ? (lang === 'th' ? 'รับเข้า (ซื้อ)' : 'PURCHASE')
                            : t.type === 'WASTE'
                            ? (lang === 'th' ? 'ของเสีย' : 'WASTE')
                            : t.type === 'STOCK_COUNT'
                            ? (lang === 'th' ? 'นับสต็อก' : 'STOCK COUNT')
                            : (lang === 'th' ? 'ปรับยอด' : 'ADJUSTMENT')}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-sans font-bold text-white">
                        {getIngDisplayName(t.ingredientId, t.ingredientName)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-white">
                        {(t.quantity ?? t.quantityChange ?? 0) > 0
                          ? `+${t.quantity ?? t.quantityChange ?? 0}`
                          : (t.quantity ?? t.quantityChange ?? 0)}{' '}
                        {localizeUnit(t.unit, lang)}
                      </td>
                      <td className="py-3 px-3 font-sans text-white/60">
                        {getLocalizedText(lang, t.reason)}
                      </td>
                      <td className="py-3 px-4 font-sans text-white/40">
                        {t.user ? getLocalizedText(lang, t.user) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: WASTE LOG */}
      {activeTab === 'WASTE' && (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
          {wasteLog.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-xs">
              {lang === 'th' ? 'ยังไม่มีการบันทึกของเสียในระบบ' : 'No waste records logged yet'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">{lang === 'th' ? 'วันที่' : 'Date'}</th>
                    <th className="py-3 px-3">{lang === 'th' ? 'วัตถุดิบที่สูญเสีย' : 'Wasted Ingredient'}</th>
                    <th className="py-3 px-3 text-right">{lang === 'th' ? 'จำนวน' : 'Quantity'}</th>
                    <th className="py-3 px-3 text-right">{lang === 'th' ? 'มูลค่าความเสียหาย (บาท)' : 'Loss Value (THB)'}</th>
                    <th className="py-3 px-3">{lang === 'th' ? 'สาเหตุ' : 'Reason'}</th>
                    <th className="py-3 px-4">{lang === 'th' ? 'ผู้บันทึก' : 'User'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {wasteLog.map((w) => (
                    <tr key={w.id} className="hover:bg-white/5">
                      <td className="py-3 px-4 font-sans text-white/60">{w.date}</td>
                      <td className="py-3 px-3 font-sans font-bold text-white">
                        {getIngDisplayName(w.ingredientId, w.ingredientName)}
                      </td>
                      <td className="py-3 px-3 text-right text-red-400 font-bold">
                        {w.quantity} {localizeUnit(w.unit, lang)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-red-400">
                        ฿{(w.cost ?? w.totalCost ?? 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 font-sans text-white/60">
                        {getLocalizedText(lang, w.reason)}
                      </td>
                      <td className="py-3 px-4 font-sans text-white/40">
                        {w.user ? getLocalizedText(lang, w.user) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PERIOD STOCK COUNT MODAL */}
      {isStockCountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="bg-[#1a1a1a]/95 backdrop-blur-2xl rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-white/20 text-white max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">
                  {lang === 'th'
                    ? 'นับสต็อกปิดงวด (Period Stock Count Snapshot)'
                    : 'Period Stock Count Snapshot'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsStockCountModalOpen(false)}
                className="p-1 text-white/40 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmStockCount} className="mt-4 flex flex-col gap-4 min-h-0 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs shrink-0">
                <div>
                  <label className="block font-bold text-white/80 mb-1">
                    {lang === 'th' ? 'วันที่นับสต็อกปิดงวด' : 'Count Date'}
                  </label>
                  <input
                    type="date"
                    required
                    value={countDate}
                    onChange={(e) => setCountDate(e.target.value)}
                    className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-white/80 mb-1">
                    {lang === 'th' ? 'หมายเหตุ (ไม่บังคับ)' : 'Notes (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={countNotes}
                    onChange={(e) => setCountNotes(e.target.value)}
                    placeholder={lang === 'th' ? 'เช่น ปิดงวดสิ้นเดือน...' : 'e.g. Month-end closing count...'}
                    className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white"
                  />
                </div>
              </div>

              <div className="overflow-y-auto border border-white/10 rounded-2xl flex-1 min-h-0">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-[#222226] z-10">
                    <tr className="border-b border-white/10 text-white/50 font-bold uppercase text-[10px]">
                      <th className="py-2.5 px-3">{lang === 'th' ? 'วัตถุดิบ' : 'Ingredient'}</th>
                      <th className="py-2.5 px-2 text-right">{lang === 'th' ? 'ในระบบ' : 'System Qty'}</th>
                      <th className="py-2.5 px-2 text-right w-32">{lang === 'th' ? 'นับได้จริง' : 'Actual Count'}</th>
                      <th className="py-2.5 px-2 text-right">{lang === 'th' ? 'ต้นทุน/หน่วย' : 'Cost/Unit'}</th>
                      <th className="py-2.5 px-3 text-right">{lang === 'th' ? 'มูลค่ารวม' : 'Total Value'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono">
                    {inventory.map((item) => {
                      const ing = ingredientsMap.get(item.ingredientId);
                      const unitCost = resolveInventoryApUnitCost(item, ing);
                      const qty = countedQuantities[item.ingredientId] ?? item.currentStock ?? 0;
                      const lineTotal = qty * unitCost;
                      return (
                        <tr key={item.id || item.ingredientId} className="hover:bg-white/5">
                          <td className="py-2 px-3 font-sans font-semibold text-white">
                            {getIngDisplayName(item.ingredientId, item.ingredientName)}
                          </td>
                          <td className="py-2 px-2 text-right text-white/50">
                            {item.currentStock.toLocaleString()} {localizeUnit(item.unit, lang)}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <NumericInput
                              type="number"
                              min={0}
                              step="any"
                              value={qty}
                              onChange={(e) => {
                                const val = Math.max(0, parseFloat(e.target.value) || 0);
                                setCountedQuantities((prev) => ({
                                  ...prev,
                                  [item.ingredientId]: val,
                                }));
                              }}
                              className="w-24 p-1.5 text-right bg-black/50 border border-white/20 rounded-lg font-mono font-bold text-white"
                            />
                          </td>
                          <td className="py-2 px-2 text-right text-white/60">
                            ฿{unitCost.toFixed(4)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-300">
                            ฿{lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-white/10 shrink-0">
                <div className="text-xs">
                  <span className="text-white/60">
                    {lang === 'th' ? 'มูลค่าสต็อกปิดงวดรวม: ' : 'Total Closing Stock Value: '}
                  </span>
                  <span className="font-mono font-bold text-lg text-emerald-400">
                    ฿{stockCountTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsStockCountModalOpen(false)}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold text-xs cursor-pointer"
                  >
                    {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold text-xs shadow-md shadow-emerald-500/20 cursor-pointer"
                  >
                    {lang === 'th' ? 'บันทึกยอดปิดงวด' : 'Save Stock Snapshot'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADJUST / WASTE MODAL */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-[#1a1a1a]/95 backdrop-blur-2xl rounded-3xl max-w-md w-full p-6 shadow-2xl border border-white/20 text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-white text-base">
                {lang === 'th' ? 'ปรับปรุงยอดสต็อก / บันทึกของเสีย' : 'Adjust Stock / Log Waste'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="p-1 text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjust} className="space-y-3.5 mt-4 text-xs">
              <CategoryIngredientSelect
                ingredients={inventoryWithCategories}
                selectedIngredientId={selectedItemId}
                onSelectIngredientId={(id) => setSelectedItemId(id)}
                formatIngredientOption={(item) =>
                  `${getIngDisplayName(item.ingredientId, item.ingredientName)} (${lang === 'th' ? 'คงเหลือ' : 'In Stock'}: ${item.currentStock} ${localizeUnit(item.unit, lang)})`
                }
                categoryLabel={lang === 'th' ? '1. เลือกหมวดหมู่วัตถุดิบก่อน' : '1. Select Category First'}
                ingredientLabel={lang === 'th' ? '2. เลือกวัตถุดิบย่อย' : '2. Select Ingredient'}
                theme="dark"
                layout="row"
                lang={lang}
                required
              />

              <div>
                <label className="block font-bold text-white/80 mb-1">
                  {lang === 'th' ? 'ประเภทการปรับปรุง' : 'Adjustment Type'}
                </label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as any)}
                  className="w-full p-2 bg-[#1a1a1a] border border-white/15 rounded-xl font-bold text-white focus:outline-none focus:border-[#F27D26]"
                >
                  <option value="ADJUSTMENT" className="bg-[#1a1a1a] text-white">
                    {lang === 'th' ? 'ปรับยอดนับจริง (Adjustment)' : 'Physical Count Adjustment'}
                  </option>
                  <option value="WASTE" className="bg-[#1a1a1a] text-white">
                    {lang === 'th' ? 'ของเสีย / ทิ้ง (Waste)' : 'Spoilage / Waste'}
                  </option>
                  <option value="PURCHASE" className="bg-[#1a1a1a] text-white">
                    {lang === 'th' ? 'รับของเข้าสต็อก (Purchase In)' : 'Stock Receipt (Purchase In)'}
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-white/80 mb-1">
                  {lang === 'th'
                    ? `จำนวน (${adjustType === 'WASTE' ? 'จำนวนที่ทิ้ง' : '+เพิ่ม หรือ -ลด'})`
                    : `Quantity (${adjustType === 'WASTE' ? 'Wasted Qty' : '+Add or -Deduct'})`}
                </label>
                <NumericInput
                  type="number"
                  step="any"
                  required
                  value={adjustQuantity}
                  onChange={(e) => setAdjustQuantity(parseFloat(e.target.value) || 0)}
                  className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-white/80 mb-1">
                  {lang === 'th' ? 'สาเหตุ / หมายเหตุ' : 'Reason / Notes'}
                </label>
                <input
                  type="text"
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white"
                  placeholder={lang === 'th' ? 'เช่น หมดอายุ, ก้นถังไหม้, นับสต็อกสิ้นวัน...' : 'e.g. Expired, burnt batch, EOD count...'}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold cursor-pointer"
                >
                  {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold shadow-md shadow-[#F27D26]/20 cursor-pointer"
                >
                  {lang === 'th' ? 'ยืนยันการปรับปรุง' : 'Confirm Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

