import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Search,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  InventoryItem,
  InventoryTransaction,
  WasteRecord,
  Ingredient,
} from '../types';
import { NumericInput } from './common/NumericInput';
import { CategoryIngredientSelect } from './common/CategoryIngredientSelect';

interface InventoryViewProps {
  inventory: InventoryItem[];
  ingredients: Ingredient[];
  transactions: InventoryTransaction[];
  wasteLog: WasteRecord[];
  onSaveAdjustment: (txn: InventoryTransaction, waste?: WasteRecord) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  inventory,
  ingredients,
  transactions,
  wasteLog,
  onSaveAdjustment,
}) => {
  const [activeTab, setActiveTab] = useState<'STOCK' | 'TRANSACTIONS' | 'WASTE'>('STOCK');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);

  // Adjustment Modal state
  const [selectedItemId, setSelectedItemId] = useState<string>(inventory[0]?.id || '');
  const [adjustType, setAdjustType] = useState<'ADJUSTMENT' | 'WASTE' | 'PURCHASE'>('ADJUSTMENT');
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState<string>('');

  const ingredientsMap = new Map<string, Ingredient>(ingredients.map((i) => [i.id, i]));

  const inventoryWithCategories = useMemo(() => {
    return inventory.map((item) => ({
      ...item,
      name: item.ingredientName,
      category: item.category || ingredientsMap.get(item.ingredientId)?.category || 'ของแห้งและเบ็ดเตล็ด',
    }));
  }, [inventory, ingredientsMap]);

  const filteredInventory = inventory.filter((item) =>
    item.ingredientName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const lowStockItems = inventory.filter((item) => item.currentStock <= item.minStock);

  const handleOpenAdjust = (item?: InventoryItem) => {
    if (item) setSelectedItemId(item.id || item.ingredientId);
    setAdjustQuantity(0);
    setAdjustReason('');
    setIsAdjustModalOpen(true);
  };

  const handleSaveAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    const item = inventory.find((i) => i.id === selectedItemId);
    if (!item) return;

    const ing = ingredientsMap.get(item.ingredientId);
    const unitCost = ing ? ing.costPerBaseUnit : 0;
    const totalCost = Math.abs(adjustQuantity) * unitCost;

    const txn: InventoryTransaction = {
      id: `txn_${Date.now()}`,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      type: adjustType,
      quantity: adjustQuantity,
      unit: item.unit,
      date: new Date().toISOString().slice(0, 10),
      reason: adjustReason || 'ปรับปรุงยอดสต็อกหน้าร้าน',
      user: 'Manager (Tony)',
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
        reason: adjustReason || 'ของเสียระหว่างเตรียม',
        date: new Date().toISOString().slice(0, 10),
        user: 'Manager (Tony)',
      };
    }

    onSaveAdjustment(txn, wasteItem);
    setIsAdjustModalOpen(false);
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            ระบบคลังสินค้าและของเสีย (Inventory & Stock Control)
          </h1>
          <p className="text-xs text-white/60 mt-0.5">
            ตรวจนับสต็อกคงเหลือ, แจ้งเตือนของใกล้หมด, และบันทึกของเสียเพื่อคุมต้นทุนรั่วไหล
          </p>
        </div>

        <button
          type="button"
          onClick={() => handleOpenAdjust()}
          className="px-4 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className="w-4 h-4" />
          <span>ปรับยอดสต็อก / ตัดของเสีย</span>
        </button>
      </div>

      {/* Low Stock Warning Banner */}
      {lowStockItems.length > 0 && (
        <div className="p-4 bg-[#FFC107]/10 rounded-2xl border border-[#FFC107]/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#FFC107] text-black rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white text-xs">
                แจ้งเตือน: มีวัตถุดิบ {lowStockItems.length} รายการ ต่ำกว่าระดับสต็อกปลอดภัย
              </h4>
              <p className="text-[11px] text-[#FFC107] mt-0.5">
                {lowStockItems.map((i) => `${i.ingredientName} (${i.currentStock} ${i.unit})`).join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10">
        <button
          type="button"
          onClick={() => setActiveTab('STOCK')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'STOCK'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          ยอดคงเหลือปัจจุบัน ({inventory.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('TRANSACTIONS')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'TRANSACTIONS'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          ประวัติการเคลื่อนไหวสต็อก ({transactions.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('WASTE')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'WASTE'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>บันทึกของเสีย (Waste Log) ({wasteLog.length})</span>
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
                placeholder="ค้นหาสต็อก..."
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
                  <th className="py-3 px-4">วัตถุดิบ</th>
                  <th className="py-3 px-3 text-right">สต็อกคงเหลือ</th>
                  <th className="py-3 px-3 text-right">สต็อกขั้นต่ำ</th>
                  <th className="py-3 px-3 text-right">สต็อกแนะนำ</th>
                  <th className="py-3 px-3 text-center">สถานะ</th>
                  <th className="py-3 px-4 text-right">ปรับยอด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {filteredInventory.map((item) => {
                  const isLow = item.currentStock <= item.minStock;
                  return (
                    <tr key={item.id} className="hover:bg-white/5">
                      <td className="py-3.5 px-4 font-sans font-bold text-white">
                        {item.ingredientName}
                      </td>
                      <td className="py-3.5 px-3 text-right font-bold text-white text-sm">
                        {item.currentStock.toLocaleString()} {item.unit}
                      </td>
                      <td className="py-3.5 px-3 text-right text-white/40">
                        {item.minStock} {item.unit}
                      </td>
                      <td className="py-3.5 px-3 text-right text-white/40">
                        {item.maxStock} {item.unit}
                      </td>
                      <td className="py-3.5 px-3 text-center font-sans">
                        {isLow ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFC107]/20 text-[#FFC107] border border-[#FFC107]/30">
                            สต็อกต่ำ
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                            ปกติ
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => handleOpenAdjust(item)}
                          className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer border border-white/10"
                        >
                          ปรับยอด
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

      {/* TAB 2: TRANSACTIONS */}
      {activeTab === 'TRANSACTIONS' && (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
          {transactions.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-xs">
              ยังไม่มีประวัติการปรับปรุงสต็อก
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">วันที่</th>
                    <th className="py-3 px-3">ประเภท</th>
                    <th className="py-3 px-3">วัตถุดิบ</th>
                    <th className="py-3 px-3 text-right">จำนวน</th>
                    <th className="py-3 px-3">เหตุผล</th>
                    <th className="py-3 px-4">ผู้บันทึก</th>
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
                              : 'bg-white/10 text-white/80 border border-white/10'
                          }`}
                        >
                          {t.type}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-sans font-bold text-white">
                        {t.ingredientName}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-white">
                        {(t.quantity ?? t.quantityChange ?? 0) > 0
                          ? `+${t.quantity ?? t.quantityChange ?? 0}`
                          : (t.quantity ?? t.quantityChange ?? 0)}{' '}
                        {t.unit}
                      </td>
                      <td className="py-3 px-3 font-sans text-white/60">{t.reason}</td>
                      <td className="py-3 px-4 font-sans text-white/40">{t.user}</td>
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
              ยังไม่มีการบันทึกของเสียในระบบ
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">วันที่</th>
                    <th className="py-3 px-3">วัตถุดิบที่สูญเสีย</th>
                    <th className="py-3 px-3 text-right">จำนวน</th>
                    <th className="py-3 px-3 text-right">มูลค่าความเสียหาย (บาท)</th>
                    <th className="py-3 px-3">สาเหตุ</th>
                    <th className="py-3 px-4">ผู้บันทึก</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {wasteLog.map((w) => (
                    <tr key={w.id} className="hover:bg-white/5">
                      <td className="py-3 px-4 font-sans text-white/60">{w.date}</td>
                      <td className="py-3 px-3 font-sans font-bold text-white">
                        {w.ingredientName}
                      </td>
                      <td className="py-3 px-3 text-right text-red-400 font-bold">
                        {w.quantity} {w.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-red-400">
                        ฿{(w.cost ?? w.totalCost ?? 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 font-sans text-white/60">{w.reason}</td>
                      <td className="py-3 px-4 font-sans text-white/40">{w.user}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ADJUST / WASTE MODAL */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-[#1a1a1a]/95 backdrop-blur-2xl rounded-3xl max-w-md w-full p-6 shadow-2xl border border-white/20 text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-white text-base">
                ปรับปรุงยอดสต็อก / บันทึกของเสีย
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
                formatIngredientOption={(item) => `${item.ingredientName} (คงเหลือ: ${item.currentStock} ${item.unit})`}
                categoryLabel="1. เลือกหมวดหมู่วัตถุดิบก่อน"
                ingredientLabel="2. เลือกวัตถุดิบย่อย"
                theme="dark"
                layout="row"
                required
              />

              <div>
                <label className="block font-bold text-white/80 mb-1">ประเภทการปรับปรุง</label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as any)}
                  className="w-full p-2 bg-[#1a1a1a] border border-white/15 rounded-xl font-bold text-white focus:outline-none focus:border-[#F27D26]"
                >
                  <option value="ADJUSTMENT" className="bg-[#1a1a1a] text-white">ปรับยอดนับจริง (Adjustment)</option>
                  <option value="WASTE" className="bg-[#1a1a1a] text-white">ของเสีย / ทิ้ง (Waste)</option>
                  <option value="PURCHASE" className="bg-[#1a1a1a] text-white">รับของเข้าสต็อก (Purchase In)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-white/80 mb-1">
                  จำนวน ({adjustType === 'WASTE' ? 'จำนวนที่ทิ้ง' : '+เพิ่ม หรือ -ลด'})
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
                <label className="block font-bold text-white/80 mb-1">สาเหตุ / หมายเหตุ</label>
                <input
                  type="text"
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full p-2 bg-black/40 border border-white/15 rounded-xl text-white"
                  placeholder="เช่น หมดอายุ, ก้นถังไหม้, นับสต็อกสิ้นวัน..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold shadow-md shadow-[#F27D26]/20 cursor-pointer"
                >
                  ยืนยันการปรับปรุง
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
