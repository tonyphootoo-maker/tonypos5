import React, { useState } from 'react';
import {
  ShoppingCart,
  Plus,
  History,
  TrendingUp,
  TrendingDown,
  X,
} from 'lucide-react';
import {
  Ingredient,
  Supplier,
  PurchaseRecord,
  PriceHistoryRecord,
  RestaurantSettings,
} from '../types';
import { calculateIngredientCost } from '../services/calculationEngine';
import { NumericInput } from './common/NumericInput';
import { CategoryIngredientSelect } from './common/CategoryIngredientSelect';

interface PurchasesViewProps {
  ingredients: Ingredient[];
  suppliers: Supplier[];
  purchases: PurchaseRecord[];
  priceHistory: PriceHistoryRecord[];
  settings: RestaurantSettings;
  onSavePurchase: (purchase: PurchaseRecord) => void;
  onUpdateIngredientPrice: (ingredientId: string, newPrice: number) => void;
  onRecordPriceChange: (record: PriceHistoryRecord) => void;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  ingredients,
  suppliers,
  purchases,
  priceHistory,
  settings,
  onSavePurchase,
  onUpdateIngredientPrice,
  onRecordPriceChange,
}) => {
  const [activeTab, setActiveTab] = useState<'PURCHASES' | 'PRICE_HISTORY'>('PURCHASES');
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);

  // New purchase form state
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>(
    ingredients[0]?.id || ''
  );
  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [quantity, setQuantity] = useState<number>(1);
  const [totalPrice, setTotalPrice] = useState<number>(100);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [autoUpdateMasterPrice, setAutoUpdateMasterPrice] = useState<boolean>(true);
  const [purchaseNotes, setPurchaseNotes] = useState<string>('');

  const selectedIngredient = ingredients.find((i) => i.id === selectedIngredientId);

  const handleOpenPurchaseModal = () => {
    if (ingredients[0]) {
      setSelectedIngredientId(ingredients[0].id);
      setTotalPrice(ingredients[0].purchasePrice);
      setQuantity(1);
    }
    setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
    setIsPurchaseModalOpen(true);
  };

  const handleSavePurchaseForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIngredient) return;

    const unitPrice = quantity > 0 ? totalPrice / quantity : totalPrice;
    const sup = suppliers.find((s) => s.id === supplierId);

    const newRecord: PurchaseRecord = {
      id: `pur_${Date.now()}`,
      invoiceNumber,
      date: purchaseDate,
      supplierId,
      supplierName: sup ? sup.name : 'ตลาดสด',
      ingredientId: selectedIngredient.id,
      ingredientName: selectedIngredient.name,
      quantity,
      unit: selectedIngredient.purchaseUnit,
      unitPrice,
      totalPrice,
      createdAt: new Date().toISOString(),
      notes: purchaseNotes,
    };

    onSavePurchase(newRecord);

    // If price changed and user selected auto update master price
    if (autoUpdateMasterPrice && Math.abs(selectedIngredient.purchasePrice - unitPrice) > 0.01) {
      onUpdateIngredientPrice(selectedIngredient.id, unitPrice);

      // Audit trail record
      const oldCalculated = calculateIngredientCost(selectedIngredient);
      const newCalculated = calculateIngredientCost({
        ...selectedIngredient,
        purchasePrice: unitPrice,
      });

      const historyEntry: PriceHistoryRecord = {
        id: `ph_${Date.now()}`,
        ingredientId: selectedIngredient.id,
        ingredientName: selectedIngredient.name,
        date: purchaseDate,
        oldPrice: selectedIngredient.purchasePrice,
        newPrice: unitPrice,
        oldCostPerUnit: oldCalculated.costPerBaseUnit,
        newCostPerUnit: newCalculated.costPerBaseUnit,
        unit: selectedIngredient.usageUnit,
        reason: `บิลซื้อ ${invoiceNumber} (${sup?.name || 'ตลาด'})`,
        user: 'ระบบบัญชีอัตโนมัติ',
      };
      onRecordPriceChange(historyEntry);
    }

    setIsPurchaseModalOpen(false);
  };

  const totalPurchasesAmount = purchases.reduce((acc, curr) => acc + (curr.totalPrice || 0), 0);

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            การสั่งซื้อและประวัติราคา (Purchases & Price Audits)
          </h1>
          <p className="text-xs text-white/60 mt-0.5">
            บันทึกบิลซื้อวัตถุดิบเข้าร้าน และประวัติการเปลี่ยนแปลงราคาเพื่อความโปร่งใสทางบัญชี
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenPurchaseModal}
          className="px-4 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black font-bold rounded-xl text-xs shadow-lg shadow-[#F27D26]/20 transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>+ บันทึกการซื้อวัตถุดิบ</span>
        </button>
      </div>



      {/* Tabs Switcher */}
      <div className="flex items-center gap-2 border-b border-white/10">
        <button
          type="button"
          onClick={() => setActiveTab('PURCHASES')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'PURCHASES'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          รายการจัดซื้อวัตถุดิบ ({purchases.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('PRICE_HISTORY')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'PRICE_HISTORY'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>ประวัติการเปลี่ยนแปลงราคา ({priceHistory.length})</span>
        </button>
      </div>

      {/* TAB 1: PURCHASES */}
      {activeTab === 'PURCHASES' && (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
          {purchases.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-xs">
              <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-white/20" />
              ยังไม่มีประวัติการซื้อวัตถุดิบในระบบ กด "+ บันทึกการซื้อวัตถุดิบ" เพื่อเริ่มต้น
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">วันที่ / บิล</th>
                    <th className="py-3 px-3">ผู้จำหน่าย (Supplier)</th>
                    <th className="py-3 px-3">วัตถุดิบ</th>
                    <th className="py-3 px-3 text-right">จำนวน</th>
                    <th className="py-3 px-3 text-right">ราคา/หน่วย</th>
                    <th className="py-3 px-4 text-right">ยอดรวม (บาท)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-white/5">
                      <td className="py-3 px-4 font-sans">
                        <div className="font-bold text-white">{p.date}</div>
                        <div className="text-[11px] text-white/40 font-mono">
                          {p.invoiceNumber || '-'}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-sans text-white/70 font-medium">
                        {p.supplierName}
                      </td>
                      <td className="py-3 px-3 font-sans font-bold text-white">
                        {p.ingredientName}
                      </td>
                      <td className="py-3 px-3 text-right text-white/80">
                        {p.quantity} {p.unit}
                      </td>
                      <td className="py-3 px-3 text-right text-white/50">
                        ฿{(p.unitPrice ?? (p.quantity > 0 ? (p.totalPrice || 0) / p.quantity : 0)).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[#FFC107] text-sm">
                        ฿{(p.totalPrice || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-white/5 border-t border-white/10 font-bold text-white">
                  <tr>
                    <td colSpan={5} className="py-3 px-4 text-right font-sans">
                      รวมมูลค่าการซื้อทั้งหมด:
                    </td>
                    <td className="py-3 px-4 text-right text-[#F27D26] text-base font-mono font-bold">
                      ฿{totalPurchasesAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PRICE CHANGE HISTORY */}
      {activeTab === 'PRICE_HISTORY' && (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
          {priceHistory.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-xs">
              <History className="w-8 h-8 mx-auto mb-2 text-white/20" />
              ยังไม่มีการบันทึกประวัติการเปลี่ยนแปลงราคาวัตถุดิบ
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">วันที่ / เวลา</th>
                    <th className="py-3 px-3">วัตถุดิบ</th>
                    <th className="py-3 px-3 text-right">ราคาซื้อเดิม</th>
                    <th className="py-3 px-3 text-center">ทิศทาง</th>
                    <th className="py-3 px-3 text-right">ราคาซื้อใหม่</th>
                    <th className="py-3 px-3 text-right">ต้นทุนใช้งานใหม่</th>
                    <th className="py-3 px-3">เหตุผล</th>
                    <th className="py-3 px-4">ผู้ทำรายการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {priceHistory.map((h) => {
                    const diff = h.newPrice - h.oldPrice;
                    const isUp = diff > 0;
                    return (
                      <tr key={h.id} className="hover:bg-white/5">
                        <td className="py-3 px-4 font-sans text-white/60 font-medium">
                          {h.date}
                        </td>
                        <td className="py-3 px-3 font-sans font-bold text-white">
                          {h.ingredientName}
                        </td>
                        <td className="py-3 px-3 text-right text-white/40">
                          ฿{h.oldPrice.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {isUp ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                              <TrendingUp className="w-3 h-3 mr-0.5" /> +฿{diff.toFixed(2)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                              <TrendingDown className="w-3 h-3 mr-0.5" /> ฿{diff.toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-white">
                          ฿{h.newPrice.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-[#FFC107]">
                          ฿{h.newCostPerUnit.toFixed(4)} / {h.unit}
                        </td>
                        <td className="py-3 px-3 font-sans text-white/60 text-[11px]">
                          {h.reason || '-'}
                        </td>
                        <td className="py-3 px-4 font-sans text-white/40 text-[11px]">
                          {h.user}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* RECORD PURCHASE MODAL */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-[#1a1a1a]/95 backdrop-blur-2xl rounded-3xl max-w-md w-full p-6 shadow-2xl border border-white/20 text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-white text-base">
                บันทึกการซื้อวัตถุดิบเข้าร้าน
              </h3>
              <button
                type="button"
                onClick={() => setIsPurchaseModalOpen(false)}
                className="p-1 text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePurchaseForm} className="space-y-3.5 mt-4 text-xs">
              <CategoryIngredientSelect
                ingredients={ingredients}
                selectedIngredientId={selectedIngredientId}
                onSelectIngredientId={(ingId, ing) => {
                  setSelectedIngredientId(ingId);
                  if (ing) setTotalPrice(ing.purchasePrice);
                }}
                categoryLabel="1. เลือกหมวดหมู่วัตถุดิบก่อน"
                ingredientLabel="2. เลือกวัตถุดิบย่อย"
                theme="dark"
                layout="row"
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-white/80 mb-1">ผู้จัดจำหน่าย</label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full p-2 bg-[#1a1a1a] border border-white/15 rounded-xl font-medium text-white"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id} className="bg-[#1a1a1a] text-white">
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white/80 mb-1">วันที่ซื้อ</label>
                  <input
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-white/80 mb-1">จำนวนที่ซื้อ</label>
                  <NumericInput
                    type="number"
                    step="any"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                    className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-white/80 mb-1">ยอดเงินรวม (บาท)</label>
                  <NumericInput
                    type="number"
                    step="0.01"
                    required
                    value={totalPrice}
                    onChange={(e) => setTotalPrice(parseFloat(e.target.value) || 0)}
                    className="w-full p-2 bg-black/40 border border-[#F27D26] rounded-xl font-mono font-bold text-[#FFC107]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-white/80 mb-1">เลขที่บิล / ใบเสร็จ</label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full p-2 bg-black/40 border border-white/15 rounded-xl font-mono text-white"
                  placeholder="เช่น INV-00123"
                />
              </div>

              <div className="p-3 bg-[#F27D26]/10 rounded-xl border border-[#F27D26]/20 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoUpdatePrice"
                  checked={autoUpdateMasterPrice}
                  onChange={(e) => setAutoUpdateMasterPrice(e.target.checked)}
                  className="w-4 h-4 rounded text-[#F27D26] accent-[#F27D26] cursor-pointer"
                />
                <label
                  htmlFor="autoUpdatePrice"
                  className="text-[11px] font-bold text-white/90 cursor-pointer"
                >
                  อัปเดตราคาซื้อในฐานข้อมูลวัตถุดิบทันที (หากราคาเปลี่ยน)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsPurchaseModalOpen(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold shadow-md shadow-[#F27D26]/20 cursor-pointer"
                >
                  บันทึกการซื้อ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
