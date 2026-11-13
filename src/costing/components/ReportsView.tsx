import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Printer,
  Info,
} from 'lucide-react';
import {
  Ingredient,
  Sauce,
  MenuItem,
  ExpenseRecord,
  SaleOrder,
  RestaurantSettings,
} from '../types';
import { StorageService } from '../services/storageService';

interface ReportsViewProps {
  ingredients: Ingredient[];
  sauces: Sauce[];
  menus: MenuItem[];
  expenses: ExpenseRecord[];
  salesOrders: SaleOrder[];
  settings: RestaurantSettings;
  onIngredientsImported: (newIngredients: Ingredient[]) => void;
  onEditIngredient: (ing: Ingredient) => void;
  onResetDefaults: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  ingredients,
  sauces,
  menus,
  expenses,
  salesOrders,
  settings,
  onIngredientsImported,
  onEditIngredient,
  onResetDefaults,
}) => {
  const [activeTab, setActiveTab] = useState<'EXPORT_IMPORT' | 'REVIEW_REQUIRED'>('EXPORT_IMPORT');
  const [importStatus, setImportStatus] = useState<{
    loading: boolean;
    success?: boolean;
    count?: number;
    warnings?: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reviewRequiredList = ingredients.filter((i) => i.isReviewRequired);

  const handleExportExcel = () => {
    StorageService.exportAllToExcel(ingredients, sauces, menus, expenses, salesOrders);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportStatus({ loading: true });
    try {
      const result = await StorageService.importExcelWorkbook(file);
      if (result.success) {
        onIngredientsImported(result.newIngredients);
        setImportStatus({
          loading: false,
          success: true,
          count: result.importedIngredientsCount,
          warnings: result.warnings,
        });
      } else {
        setImportStatus({
          loading: false,
          success: false,
          count: 0,
          warnings: result.warnings,
        });
      }
    } catch (err: any) {
      setImportStatus({
        loading: false,
        success: false,
        warnings: [err.message || 'เกิดข้อผิดพลาดในการอ่านไฟล์ Excel'],
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            รายงาน การส่งออก และตรวจทานข้อมูล (Reports & Audit)
          </h1>
          <p className="text-xs text-white/60 mt-0.5">
            ส่งออกไฟล์ Excel สมบูรณ์แบบ 5 แผ่นงาน, นำเข้าสมุดงาน, และตรวจสอบรายการตกหล่น
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer border border-white/10"
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์รายงาน</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>ส่งออกสมุดงาน Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10">
        <button
          type="button"
          onClick={() => setActiveTab('EXPORT_IMPORT')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'EXPORT_IMPORT'
              ? 'border-[#F27D26] text-[#F27D26]'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>ส่งออกและนำเข้า Excel</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('REVIEW_REQUIRED')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'REVIEW_REQUIRED'
              ? 'border-red-500 text-red-400'
              : 'border-transparent text-white/50 hover:text-white'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span>ข้อมูลที่ต้องตรวจทาน (DATA_REVIEW_REQUIRED) ({reviewRequiredList.length})</span>
        </button>
      </div>

      {/* TAB 1: EXPORT & IMPORT */}
      {activeTab === 'EXPORT_IMPORT' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Export Card */}
            <div className="bg-white/5 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    ส่งออกข้อมูลทั้งหมดเป็น Excel
                  </h3>
                  <span className="text-xs text-white/50">
                    ครบ 5 แผ่นงาน (วัตถุดิบ, ซอส, เมนู, ค่าใช้จ่าย, ยอดขาย)
                  </span>
                </div>
              </div>

              <p className="text-xs text-white/70 leading-relaxed">
                สร้างไฟล์ Excel (.xlsx) ที่ตรงตามโครงสร้างสมุดงานบัญชีของ Tony's Kitchen
                พร้อมสูตรต้นทุน Yield และกำไรต่อจาน เพื่อเปิดใน Microsoft Excel หรือ Google Sheets
              </p>

              <button
                type="button"
                onClick={handleExportExcel}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>ดาวน์โหลด TonysKitchen_FoodCost.xlsx</span>
              </button>
            </div>

            {/* Import Card */}
            <div className="bg-white/5 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#F27D26]/20 border border-[#F27D26]/30 text-[#F27D26] flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    นำเข้าไฟล์ Excel ของร้าน (Excel Importer)
                  </h3>
                  <span className="text-xs text-white/50">
                    รองรับสมุดงาน ทำแอปต้นทุนอาหาร(1).xlsx
                  </span>
                </div>
              </div>

              <p className="text-xs text-white/70 leading-relaxed">
                อัปโหลดไฟล์สมุดงานเดิม ระบบจะอ่านข้อมูลวัตถุดิบ ราคาซื้อ และคำนวณ Yield ให้อัตโนมัติ
                หากมีแถวข้อมูลขาดหาย ระบบจะขึ้นสถานะ DATA_REVIEW_REQUIRED ให้ตรวจสอบ
              </p>

              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx, .xls"
                onChange={handleFileChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>เลือกไฟล์ Excel เพื่อนำเข้า (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Import Result Notification */}
          {importStatus && (
            <div
              className={`p-5 rounded-2xl border ${
                importStatus.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                  : 'bg-red-500/10 border-red-500/30 text-white'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-xs">
                {importStatus.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                )}
                <span>
                  {importStatus.success
                    ? `นำเข้าวัตถุดิบสำเร็จจำนวน ${importStatus.count} รายการ!`
                    : 'การนำเข้าไม่สมบูรณ์ กรุณาตรวจสอบไฟล์'}
                </span>
              </div>

              {importStatus.warnings && importStatus.warnings.length > 0 && (
                <div className="mt-3 text-xs space-y-1 max-h-32 overflow-y-auto font-mono text-white/60">
                  {importStatus.warnings.map((w, idx) => (
                    <div key={idx}>• {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reset Defaults Box */}
          <div className="p-5 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
            <div>
              <span className="font-bold text-white block">
                รีเซ็ตข้อมูลทั้งหมดกลับสู่ค่าเริ่มต้นของ Tony's Kitchen
              </span>
              <span className="text-white/50 text-[11px]">
                ล้างข้อมูลในบราวเซอร์และโหลดวัตถุดิบ ซอส และเมนูกะเพราต้นฉบับกลับมา
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (confirm('คุณแน่ใจหรือไม่ที่จะรีเซ็ตข้อมูลทั้งหมดกลับสู่ค่าเริ่มต้น?')) {
                  onResetDefaults();
                }
              }}
              className="px-3.5 py-2 bg-white/10 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 text-white/80 border border-white/10 rounded-xl font-bold transition-colors cursor-pointer self-start sm:self-auto"
            >
              รีเซ็ตค่าเริ่มต้น (Factory Reset)
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: DATA QUALITY REVIEW */}
      {activeTab === 'REVIEW_REQUIRED' && (
        <div className="space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 text-xs text-white">
            <Info className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">หลักการบัญชีของ Tony's Kitchen:</span>
              <p className="mt-0.5 text-[11px] text-white/70 leading-relaxed">
                "ห้ามให้อาหารที่ดูเหมือนทำกำไร เกิดขึ้นเพียงเพราะข้อมูลต้นทุนที่หายไปถูกคำนวณเป็นศูนย์"
                รายการด้านล่างคือวัตถุดิบที่มีราคาเป็น 0, Yield เป็น 0, หรือนำเข้าข้อมูลไม่สมบูรณ์
                กรุณาตรวจสอบและแก้ไขเพื่อความแม่นยำทางบัญชี
              </p>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl overflow-hidden">
            {reviewRequiredList.length === 0 ? (
              <div className="text-center py-12 text-white/40 text-xs">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                <span className="font-bold text-white text-sm block">
                  ยอดเยี่ยม! ข้อมูลวัตถุดิบทุกรายการสมบูรณ์ 100%
                </span>
                <span className="text-white/40 mt-1 block">
                  ไม่มีรายการใดค้างอยู่ในสถานะรอตรวจทาน
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10 text-white/50 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">วัตถุดิบ</th>
                      <th className="py-3 px-3">หมวดหมู่</th>
                      <th className="py-3 px-3">ราคาซื้อ</th>
                      <th className="py-3 px-3">Yield</th>
                      <th className="py-3 px-3">สาเหตุที่ต้องตรวจทาน</th>
                      <th className="py-3 px-4 text-right">แก้ไข</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {reviewRequiredList.map((ing) => (
                      <tr key={ing.id} className="hover:bg-red-500/5">
                        <td
                          className="py-3.5 px-4 font-bold text-white cursor-pointer select-none hover:text-[#F27D26] hover:underline transition-colors"
                          onDoubleClick={() => onEditIngredient(ing)}
                          title="ดับเบิลคลิกเพื่อแก้ไขข้อมูลวัตถุดิบ"
                        >
                          {ing.name}
                        </td>
                        <td className="py-3.5 px-3 text-white/60">{ing.category}</td>
                        <td className="py-3.5 px-3 font-mono font-bold text-red-400">
                          ฿{ing.purchasePrice} / {ing.purchaseQuantity} {ing.purchaseUnit}
                        </td>
                        <td className="py-3.5 px-3 font-mono text-white/80">{ing.yieldPercent}%</td>
                        <td className="py-3.5 px-3 text-red-400 font-medium">
                          {ing.reviewReason || 'ข้อมูลไม่สมบูรณ์'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => onEditIngredient(ing)}
                            className="px-3 py-1.5 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl font-bold text-xs cursor-pointer shadow-sm"
                          >
                            แก้ไขทันที
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
