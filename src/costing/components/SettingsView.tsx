import React, { useState } from 'react';
import {
  Save,
  ShieldCheck,
  Package,
  Store,
  CheckCircle2,
  Smartphone,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react';
import { RestaurantSettings } from '../types';
import { NumericInput } from './common/NumericInput';
import { AppIconService } from '../services/appIconService';

interface SettingsViewProps {
  settings: RestaurantSettings;
  onSaveSettings: (settings: RestaurantSettings) => void;
  onOpenIconModal?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onSaveSettings, onOpenIconModal }) => {
  const [localSettings, setLocalSettings] = useState<RestaurantSettings>(() => ({
    ...settings,
    restaurantName: settings.restaurantName || '',
    targetFoodCostPercent: settings.targetFoodCostPercent ?? 40,
    overheadRatePercent: settings.overheadRatePercent ?? 10,
    overheadCalculationBase: settings.overheadCalculationBase || 'SELLING_PRICE',
    defaultOverheadCost: settings.defaultOverheadCost ?? settings.defaultOverheadCostPerDish ?? 25,
    defaultOverheadCostPerDish: settings.defaultOverheadCostPerDish ?? settings.defaultOverheadCost ?? 25,
    packagingCostTakeaway: settings.packagingCostTakeaway ?? settings.takeawayPackagingCost ?? 5,
    takeawayPackagingCost: settings.takeawayPackagingCost ?? settings.packagingCostTakeaway ?? 5,
    vatRatePercent: settings.vatRatePercent ?? 7,
    incomeTaxRatePercent: settings.incomeTaxRatePercent ?? 20,
    grabFoodCommissionPercent: settings.grabFoodCommissionPercent ?? 30,
    lineManCommissionPercent: settings.lineManCommissionPercent ?? 25,
  }));
  const [savedSuccess, setSavedSuccess] = useState(false);

  React.useEffect(() => {
    setLocalSettings({
      ...settings,
      restaurantName: settings.restaurantName || '',
      targetFoodCostPercent: settings.targetFoodCostPercent ?? 40,
      overheadRatePercent: settings.overheadRatePercent ?? 10,
      overheadCalculationBase: settings.overheadCalculationBase || 'SELLING_PRICE',
      defaultOverheadCost: settings.defaultOverheadCost ?? settings.defaultOverheadCostPerDish ?? 25,
      defaultOverheadCostPerDish: settings.defaultOverheadCostPerDish ?? settings.defaultOverheadCost ?? 25,
      packagingCostTakeaway: settings.packagingCostTakeaway ?? settings.takeawayPackagingCost ?? 5,
      takeawayPackagingCost: settings.takeawayPackagingCost ?? settings.packagingCostTakeaway ?? 5,
      vatRatePercent: settings.vatRatePercent ?? 7,
      incomeTaxRatePercent: settings.incomeTaxRatePercent ?? 20,
      grabFoodCommissionPercent: settings.grabFoodCommissionPercent ?? 30,
      lineManCommissionPercent: settings.lineManCommissionPercent ?? 25,
    });
  }, [settings]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(localSettings);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            ตั้งค่าระบบร้าน (Restaurant System Settings)
          </h1>
          <p className="text-xs text-white/60 mt-0.5">
            กำหนดค่าโสหุ้ยต่อจาน, ค่าคอมมิชชั่น GP เดลิเวอรี, เป้าหมาย Food Cost %, และสิทธิ์การใช้งาน
          </p>
        </div>

        <button
          type="submit"
          form="settings-form"
          className="px-5 py-2.5 bg-[#F27D26] hover:bg-[#d96817] text-black rounded-xl text-xs font-bold shadow-lg shadow-[#F27D26]/20 transition-all flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <Save className="w-4 h-4" />
          <span>บันทึกการตั้งค่า</span>
        </button>
      </div>

      {savedSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-xs text-white font-bold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>บันทึกการตั้งค่าระบบเรียบร้อยแล้ว การคำนวณทั้งหมดได้รับการปรับปรุงทันที</span>
        </div>
      )}

      <form id="settings-form" onSubmit={handleSave} className="space-y-4">
        {/* General Info */}
        <div className="bg-white/5 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <Store className="w-5 h-5 text-[#F27D26]" />
            <h2 className="text-base font-bold text-white">ข้อมูลร้านและเป้าหมายต้นทุน</h2>
          </div>


          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-bold text-white/80 mb-1">ชื่อร้านอาหาร</label>
              <input
                type="text"
                required
                value={localSettings.restaurantName}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, restaurantName: e.target.value })
                }
                className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl font-medium text-white focus:outline-none focus:border-[#F27D26]"
              />
            </div>

            <div>
              <label className="block font-bold text-white/80 mb-1">
                เป้าหมาย Food Cost % (Target FC %)
              </label>
              <div className="relative">
                <NumericInput
                  type="number"
                  step="0.5"
                  required
                  value={localSettings.targetFoodCostPercent}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      targetFoodCostPercent: parseFloat(e.target.value) || 40,
                    })
                  }
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white focus:outline-none focus:border-[#F27D26]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">
                  %
                </span>
              </div>
            </div>

            <div>
              <label className="block font-bold text-white/80 mb-1">
                อัตราโสหุ้ย (%) / Overhead rate (%)
              </label>
              <div className="relative">
                <NumericInput
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  required
                  value={localSettings.overheadRatePercent ?? 10}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setLocalSettings({
                      ...localSettings,
                      overheadRatePercent: val,
                    });
                  }}
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white focus:outline-none focus:border-[#F27D26]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">
                  %
                </span>
              </div>
            </div>

            <div>
              <label className="block font-bold text-white/80 mb-1">
                คิดโสหุ้ยจาก / Calculate overhead based on
              </label>
              <select
                value={localSettings.overheadCalculationBase || 'SELLING_PRICE'}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    overheadCalculationBase: e.target.value as 'SELLING_PRICE' | 'FOOD_COST',
                  })
                }
                className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl font-medium text-white focus:outline-none focus:border-[#F27D26]"
              >
                <option value="SELLING_PRICE" className="bg-[#1a1a1a] text-white">
                  ราคาขายสุทธิ / Selling price ex-VAT (มาตรฐานสากล - DEFAULT)
                </option>
                <option value="FOOD_COST" className="bg-[#1a1a1a] text-white">
                  ต้นทุนวัตถุดิบ / Food Cost (ไม่แนะนำ)
                </option>
              </select>
              <p className="text-[10px] text-white/40 mt-1">
                มาตรฐานบัญชีร้านอาหารสากลกำหนดให้คำนวณโสหุ้ยเป็น % ของราคาขายสุทธิ (ex-VAT)
              </p>
            </div>

            <div>
              <label className="block font-bold text-white/80 mb-1">
                อัตรา VAT (%)
              </label>
              <div className="relative">
                <NumericInput
                  type="number"
                  step="any"
                  min="0"
                  max="20"
                  required
                  value={localSettings.vatRatePercent ?? 7}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setLocalSettings({
                      ...localSettings,
                      vatRatePercent: Number.isFinite(val) ? val : 0,
                    });
                  }}
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white focus:outline-none focus:border-[#F27D26]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">
                  %
                </span>
              </div>
              <p className="text-[10px] text-white/40 mt-1">
                ใช้คำนวณราคาขายสุทธิ (ex-VAT) และค่า GP
              </p>
            </div>

            <div>
              <label className="block font-bold text-white/80 mb-1">
                อัตราภาษีเงินได้ (ประมาณการ) (%)
              </label>
              <div className="relative">
                <NumericInput
                  type="number"
                  step="any"
                  min="0"
                  max="50"
                  required
                  value={localSettings.incomeTaxRatePercent ?? 20}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setLocalSettings({
                      ...localSettings,
                      incomeTaxRatePercent: Number.isFinite(val) ? val : 0,
                    });
                  }}
                  className="w-full p-2.5 bg-black/40 border border-white/15 rounded-xl font-mono font-bold text-white focus:outline-none focus:border-[#F27D26]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">
                  %
                </span>
              </div>
              <p className="text-[10px] text-white/40 mt-1">
                ตัวเลขนี้เป็นการประมาณการเพื่อดูภาพรวม ไม่ใช่ตัวเลขสำหรับยื่นภาษี กรุณาปรึกษานักบัญชี
              </p>
            </div>
          </div>
        </div>

        {/* Delivery Channels GP (Owner-Defined GP%) */}
        <div className="bg-white/5 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <Package className="w-5 h-5 text-[#F27D26]" />
            <div>
              <h2 className="text-base font-bold text-white">
                Sales Channels & ค่า GP เดลิเวอรี (Owner-Defined GP%)
              </h2>
              <p className="text-[11px] text-white/50">
                กำหนดค่าคอมมิชชั่น GP % แยกตามช่องทางขาย (GrabFood และ LINE MAN)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* GrabFood GP */}
            <div className="p-4 bg-black/30 rounded-2xl border border-emerald-500/20">
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-emerald-400">
                  GrabFood GP %
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-900 font-bold">Active</span>
              </div>
              <div className="relative">
                <NumericInput
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  required
                  value={localSettings.grabFoodCommissionPercent ?? 30}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    const updatedChannels = (localSettings.channels || []).map((c) =>
                      c.channelId === 'grab' ? { ...c, commissionPercent: val } : c
                    );
                    setLocalSettings({
                      ...localSettings,
                      grabFoodCommissionPercent: val,
                      channels: updatedChannels,
                    });
                  }}
                  className="w-full p-2.5 bg-black/60 border border-emerald-500/40 rounded-xl font-mono font-bold text-white focus:outline-none focus:border-emerald-400"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">
                  %
                </span>
              </div>
              <span className="text-[11px] text-white/40 mt-1.5 block">
                สูตร: GP = ยอดขาย Grab × GP%
              </span>
            </div>

            {/* LINE MAN GP */}
            <div className="p-4 bg-black/30 rounded-2xl border border-green-500/20">
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-green-400">
                  LINE MAN GP %
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-950 font-bold">Active</span>
              </div>
              <div className="relative">
                <NumericInput
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  required
                  value={localSettings.lineManCommissionPercent ?? 25}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    const updatedChannels = (localSettings.channels || []).map((c) =>
                      c.channelId === 'lineman' ? { ...c, commissionPercent: val } : c
                    );
                    setLocalSettings({
                      ...localSettings,
                      lineManCommissionPercent: val,
                      channels: updatedChannels,
                    });
                  }}
                  className="w-full p-2.5 bg-black/60 border border-green-500/40 rounded-xl font-mono font-bold text-white focus:outline-none focus:border-green-400"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">
                  %
                </span>
              </div>
              <span className="text-[11px] text-white/40 mt-1.5 block">
                สูตร: GP = ยอดขาย LINE MAN × GP%
              </span>
            </div>
          </div>
        </div>

        {/* Roles & Permissions */}
        <div className="bg-white/5 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <ShieldCheck className="w-5 h-5 text-[#F27D26]" />
            <h2 className="text-base font-bold text-white">
              สิทธิ์การใช้งาน (Role-Based Access Control)
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div
              onClick={() => setLocalSettings({ ...localSettings, userRole: 'OWNER' })}
              className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                localSettings.userRole === 'OWNER'
                  ? 'bg-[#F27D26]/20 border-[#F27D26] shadow-md shadow-[#F27D26]/10'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="font-bold text-white text-sm">OWNER (เจ้าของร้าน)</div>
              <p className="text-[11px] text-white/60 mt-1">
                เข้าถึงได้ทุกส่วน: ดูงบ P&L, แก้ไขสูตรอาหาร, ปรับราคาขาย, ลบ/รีเซ็ตข้อมูล, จัดการผู้ใช้
              </p>
            </div>

            <div
              onClick={() => setLocalSettings({ ...localSettings, userRole: 'MANAGER' })}
              className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                localSettings.userRole === 'MANAGER'
                  ? 'bg-[#F27D26]/20 border-[#F27D26] shadow-md shadow-[#F27D26]/10'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="font-bold text-white text-sm">MANAGER (ผู้จัดการ)</div>
              <p className="text-[11px] text-white/60 mt-1">
                จัดการวัตถุดิบ, ดูต้นทุนต่อจาน และบันทึกค่าใช้จ่ายร้าน
              </p>
            </div>

            <div
              onClick={() => setLocalSettings({ ...localSettings, userRole: 'STAFF' })}
              className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                localSettings.userRole === 'STAFF'
                  ? 'bg-[#F27D26]/20 border-[#F27D26] shadow-md shadow-[#F27D26]/10'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="font-bold text-white text-sm">STAFF (พนักงานหน้าร้าน)</div>
              <p className="text-[11px] text-white/60 mt-1">
                บันทึกยอดขายหน้าร้าน และตรวจดูสูตรตวงชั่งตามมาตรฐาน
              </p>
            </div>
          </div>
        </div>

        {/* Mobile & Tablet App Installation & Custom Icon */}
        <div className="bg-white/5 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#F27D26] text-white flex items-center justify-center font-bold shadow-xs">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  แอปมือถือ & แท็บเล็ต และไอคอนแอป (Mobile PWA & App Icon)
                </h2>
                <p className="text-[11px] text-white/60">
                  ดาวน์โหลดติดตั้งแอปไว้บนหน้าจอโฮมของมือถือ/แท็บเล็ต และปรับแต่งรูปไอคอนแอปตามต้องการ
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10 gap-4">
            <div className="flex items-center gap-3">
              <img
                src={AppIconService.getCurrentIcon()}
                alt="Current App Icon"
                className="w-14 h-14 rounded-2xl shadow-lg ring-2 ring-[#F27D26]/40 object-cover bg-white shrink-0"
              />
              <div>
                <div className="text-xs font-bold text-white">รูปไอคอนแอปปัจจุบัน (Active Icon)</div>
                <div className="text-[11px] text-white/60 mt-0.5">
                  ไอคอนที่แสดงบนแท็บเบราว์เซอร์ และหน้าจอโฮมเมื่อติดตั้งลงบนมือถือ/แท็บเล็ต
                </div>
              </div>
            </div>

            {onOpenIconModal && (
              <button
                type="button"
                onClick={onOpenIconModal}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold border border-white/20 transition-all flex items-center gap-2 cursor-pointer shrink-0 shadow-xs"
              >
                <ImageIcon className="w-4 h-4 text-[#F27D26]" />
                <span>เปลี่ยนรูปไอคอนแอป...</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
