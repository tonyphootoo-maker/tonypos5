import React, { useState, useRef } from 'react';
import { X, Upload, Check, RefreshCw, Smartphone, Tablet, Download, Sparkles, Image as ImageIcon } from 'lucide-react';
import { AppIconService, APP_ICON_PRESETS, AppIconPreset } from '../../services/appIconService';

interface AppIconModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIconChanged?: (newIconUrl: string) => void;
}

export const AppIconModal: React.FC<AppIconModalProps> = ({
  isOpen,
  onClose,
  onIconChanged,
}) => {
  const [currentIcon, setCurrentIcon] = useState<string>(() => AppIconService.getCurrentIcon());
  const [selectedPresetId, setSelectedPresetId] = useState<string>('default');
  const [customUploadedData, setCustomUploadedData] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'tablet'>('mobile');
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: AppIconPreset) => {
    setSelectedPresetId(preset.id);
    setCurrentIcon(preset.svgDataUri);
    setCustomUploadedData(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setSaveSuccessMessage('กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP หรือ SVG)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setCustomUploadedData(result);
      setCurrentIcon(result);
      setSelectedPresetId('custom');
    };
    reader.readAsDataURL(file);
  };

  const handleApplyIcon = () => {
    const activePreset = APP_ICON_PRESETS.find((p) => p.id === selectedPresetId);
    const themeColor = activePreset ? activePreset.themeColor : '#F27D26';
    AppIconService.setCustomIcon(currentIcon, themeColor);
    if (onIconChanged) {
      onIconChanged(currentIcon);
    }
    setSaveSuccessMessage('บันทึกรูปไอคอนใหม่เรียบร้อยแล้ว!');
    setTimeout(() => {
      setSaveSuccessMessage(null);
      onClose();
    }, 1200);
  };

  const handleResetDefault = () => {
    AppIconService.resetToDefault();
    setSelectedPresetId('default');
    setCurrentIcon(APP_ICON_PRESETS[0].svgDataUri);
    setCustomUploadedData(null);
    if (onIconChanged) {
      onIconChanged(APP_ICON_PRESETS[0].svgDataUri);
    }
    setSaveSuccessMessage('รีเซ็ตเป็นไอคอนเริ่มต้นเรียบร้อยแล้ว');
    setTimeout(() => setSaveSuccessMessage(null), 1500);
  };

  const handleDownloadIcon = () => {
    const link = document.createElement('a');
    link.href = currentIcon;
    link.download = `tony_kitchen_app_icon_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-2xl rounded-3xl bg-[#FAF8F5] p-5 sm:p-6 shadow-2xl border border-stone-200 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-stone-200/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#EA580C] to-[#F27D26] text-white flex items-center justify-center font-bold shadow-sm shadow-[#F27D26]/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-stone-900 leading-tight">
                เปลี่ยนรูปไอคอนแอป (Custom App Icon)
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                เลือกไอคอนร้านอาหารที่ชอบ หรืออัปโหลดโลโก้ร้านของตัวเองสำหรับหน้าจอมือถือและแท็บเล็ต
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 p-1.5 rounded-xl hover:bg-stone-100 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success toast */}
        {saveSuccessMessage && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveSuccessMessage}</span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left Column: Preset options & Upload */}
          <div className="md:col-span-7 space-y-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-2">
                1. เลือกจากชุดไอคอนสำเร็จรูป (Preset Gallery)
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {APP_ICON_PRESETS.map((preset) => {
                  const isSelected = selectedPresetId === preset.id && !customUploadedData;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`flex items-start gap-2.5 p-2.5 rounded-2xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#F27D26] bg-orange-50/70 ring-2 ring-[#F27D26]/20 shadow-xs'
                          : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                      }`}
                    >
                      <img
                        src={preset.svgDataUri}
                        alt={preset.nameTh}
                        className="w-10 h-10 rounded-xl shrink-0 object-cover shadow-2xs"
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-stone-800 truncate">
                          {preset.nameTh.split('(')[0]}
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5 line-clamp-2 leading-tight">
                          {preset.descriptionTh}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Upload Section */}
            <div className="pt-2">
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-2">
                2. หรืออัปโหลดรูปภาพ / โลโก้ร้านของคุณเอง
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`p-4 rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center ${
                  customUploadedData
                    ? 'border-[#F27D26] bg-orange-50/50'
                    : 'border-stone-300 hover:border-[#F27D26] bg-white hover:bg-orange-50/20'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                />
                <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#F27D26] flex items-center justify-center mb-2">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="font-bold text-xs text-stone-800">
                  {customUploadedData ? 'เปลี่ยนรูปที่อัปโหลด' : 'คลิกเพื่อเลือกไฟล์รูปภาพจากเครื่อง'}
                </div>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  รองรับ PNG, JPG, WebP หรือ SVG (แนะนำรูปทรงสี่เหลี่ยมจัตุรัส)
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Live Mockup Preview */}
          <div className="md:col-span-5 flex flex-col items-center justify-between p-4 rounded-2xl bg-white border border-stone-200 shadow-xs">
            <div className="w-full">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-100">
                <span className="text-xs font-bold text-stone-700">ตัวอย่างบนหน้าจอจริง</span>
                <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('mobile')}
                    className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                      previewDevice === 'mobile' ? 'bg-white shadow-2xs text-stone-900' : 'text-stone-500'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5 inline mr-1" />
                    มือถือ
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('tablet')}
                    className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                      previewDevice === 'tablet' ? 'bg-white shadow-2xs text-stone-900' : 'text-stone-500'
                    }`}
                  >
                    <Tablet className="w-3.5 h-3.5 inline mr-1" />
                    แท็บเล็ต
                  </button>
                </div>
              </div>

              {/* Realistic Phone / Tablet Home Screen Mockup */}
              <div className="mx-auto w-full max-w-[210px] aspect-[9/14] rounded-3xl bg-slate-900 p-2.5 shadow-xl border-4 border-slate-700 relative flex flex-col justify-between overflow-hidden">
                {/* Wallpaper gradient */}
                <div className="absolute inset-0 bg-gradient-to-b from-indigo-950 via-slate-900 to-amber-950 opacity-90 pointer-events-none" />

                {/* Status bar */}
                <div className="relative z-10 flex items-center justify-between text-[9px] text-white/80 px-2 pt-1 font-mono">
                  <span>9:41</span>
                  <div className="flex items-center gap-1 text-[8px]">
                    <span>5G</span>
                    <div className="w-3 h-1.5 border border-white/80 rounded-xs flex items-center p-0.2">
                      <div className="w-full h-full bg-white/90 rounded-2xs" />
                    </div>
                  </div>
                </div>

                {/* Home Screen Icons Grid with Tony's Kitchen App Highlighted */}
                <div className="relative z-10 grid grid-cols-3 gap-2 px-1 py-4 text-center">
                  {/* System app 1 */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center text-xs shadow-md">
                      ✉️
                    </div>
                    <span className="text-[9px] text-white/70">Mail</span>
                  </div>

                  {/* TONY'S KITCHEN APP (ACTIVE PREVIEW) */}
                  <div className="flex flex-col items-center gap-1 scale-105">
                    <div className="relative">
                      <img
                        src={currentIcon}
                        alt="App Icon Preview"
                        className="w-11 h-11 rounded-2xl shadow-lg ring-2 ring-white/40 object-cover"
                      />
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center border border-slate-900 shadow-xs">
                        1
                      </span>
                    </div>
                    <span className="text-[10px] text-white font-bold tracking-tight drop-shadow-md">
                      TonyKitchen
                    </span>
                  </div>

                  {/* System app 2 */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-xs shadow-md">
                      💬
                    </div>
                    <span className="text-[9px] text-white/70">LINE</span>
                  </div>
                </div>

                {/* Bottom Dock */}
                <div className="relative z-10 mx-auto w-11/12 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-around px-2 mb-1">
                  <div className="w-7 h-7 rounded-lg bg-green-500/80 flex items-center justify-center text-[10px]">📞</div>
                  <div className="w-7 h-7 rounded-lg bg-blue-400/80 flex items-center justify-center text-[10px]">🌐</div>
                  <div className="w-7 h-7 rounded-lg bg-purple-500/80 flex items-center justify-center text-[10px]">🎵</div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="w-full mt-3 flex items-center justify-between text-xs text-stone-500 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={handleResetDefault}
                className="hover:text-stone-800 flex items-center gap-1 cursor-pointer transition-colors"
                title="ย้อนกลับเป็นไอคอนค่าเริ่มต้น"
              >
                <RefreshCw className="w-3 h-3" />
                <span>รีเซ็ตค่าเริ่มต้น</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadIcon}
                className="hover:text-stone-800 flex items-center gap-1 cursor-pointer transition-colors"
                title="ดาวน์โหลดรูปไอคอนเก็บไว้"
              >
                <Download className="w-3 h-3" />
                <span>ดาวน์โหลดรูป</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 pt-4 border-t border-stone-200/80 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-stone-600 hover:text-stone-800 bg-white hover:bg-stone-100 border border-stone-200 text-xs font-semibold cursor-pointer transition-colors"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleApplyIcon}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#F27D26] to-[#EA580C] hover:from-[#EA580C] hover:to-[#D97706] text-white text-xs font-bold shadow-sm hover:shadow transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>นำไอคอนนี้ไปใช้งาน</span>
          </button>
        </div>
      </div>
    </div>
  );
};
