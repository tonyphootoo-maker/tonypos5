import React, { useState, useEffect } from 'react';
import { SettingsDoc, Language } from '../types';
import { translations } from '../i18n/translations';
import {
  updateSettings,
  saveImageDoc,
  getImageDoc,
  rebuildSummariesFromBills,
  auditSummariesAgainstBills,
} from '../data/db';
import { compressImage } from '../utils/imageCompressor';
import { PWAInstallButton } from '../components/PWAInstallButton';
import {
  Settings,
  Store,
  Percent,
  Clock,
  QrCode,
  Star,
  CheckCircle2,
  AlertTriangle,
  Upload,
  RefreshCw,
  Save,
  ShieldCheck,
  BookOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
  onSettingsUpdated: (newSettings: SettingsDoc) => void;
}

export const SettingsPage: React.FC<Props> = ({
  settings,
  lang,
  onSettingsUpdated,
}) => {
  const t = translations[lang];

  const [form, setForm] = useState<SettingsDoc>({ ...settings });
  const [showFormulaGuide, setShowFormulaGuide] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audit and rebuild states
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<{ isMatch: boolean; discrepantDates: string[] } | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);

  useEffect(() => {
    setForm({ ...settings });
    if (settings.qrImageId) {
      getImageDoc(settings.qrImageId).then((img) => {
        if (img?.dataUrl) setQrDataUrl(img.dataUrl);
      });
    }
  }, [settings]);

  const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { dataUrl, sizeBytes } = await compressImage(file);
      const imgId = `qr_${Date.now()}`;
      await saveImageDoc(imgId, dataUrl, sizeBytes);
      setQrDataUrl(dataUrl);
      setForm((prev) => ({ ...prev, qrImageId: imgId }));
    } catch (err) {
      console.error('QR upload error:', err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    setErrorMsg(null);

    try {
      await updateSettings(form, settings.version);
      const updated: SettingsDoc = {
        ...form,
        version: settings.version + 1,
        updatedAt: new Date().toISOString(),
      };
      onSettingsUpdated(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      console.error('Settings update error:', err);
      setErrorMsg(
        err instanceof Error && err.message === 'VERSION_CONFLICT'
          ? t.common.versionConflict
          : 'Failed to save settings'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunAudit = async () => {
    setIsAuditing(true);
    setAuditResult(null);
    setRebuildResult(null);
    try {
      const res = await auditSummariesAgainstBills();
      setAuditResult(res);
    } catch (err) {
      console.error('Audit error:', err);
    } finally {
      setIsAuditing(false);
    }
  };

  const handleRebuildSummaries = async () => {
    if (!confirm('Rebuild and synchronize all daily summaries from real bills?')) return;
    setIsRebuilding(true);
    setAuditResult(null);
    try {
      const res = await rebuildSummariesFromBills();
      setRebuildResult(`Rebuilt ${res.rebuiltCount} daily summaries successfully.`);
    } catch (err) {
      console.error('Rebuild error:', err);
    } finally {
      setIsRebuilding(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6 select-none">
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-neutral-700" />
          <span>{t.settings.title}</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          Configure business info, food cost warnings, tax/service rates, PromptPay QR image, and daily closing times.
        </p>
      </div>

      {saveSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-800 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{t.common.success}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-2xl text-rose-800 text-xs font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <PWAInstallButton lang={lang} variant="card" />

      <form onSubmit={handleSave} className="space-y-6">
        {/* Shop Profile & Receipt */}
        <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-4">
          <h3 className="font-extrabold text-sm text-neutral-900 flex items-center gap-2">
            <Store className="w-4 h-4 text-orange-600" />
            <span>{t.settings.shopProfile}</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.shopName}
              </label>
              <input
                type="text"
                required
                value={form.shopName || ''}
                onChange={(e) => setForm({ ...form, shopName: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.shopPhone}
              </label>
              <input
                type="text"
                value={form.shopPhone || ''}
                onChange={(e) => setForm({ ...form, shopPhone: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.shopAddress}
              </label>
              <input
                type="text"
                value={form.shopAddress || ''}
                onChange={(e) => setForm({ ...form, shopAddress: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.taxId}
              </label>
              <input
                type="text"
                value={form.taxId || ''}
                onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.receiptHeader}
              </label>
              <input
                type="text"
                value={form.receiptHeader || ''}
                onChange={(e) => setForm({ ...form, receiptHeader: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.receiptFooter}
              </label>
              <input
                type="text"
                value={form.receiptFooter || ''}
                onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* Cost, VAT, Service Charge & Daily Closing Time */}
        <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-4">
          <h3 className="font-extrabold text-sm text-neutral-900 flex items-center gap-2">
            <Percent className="w-4 h-4 text-red-600" />
            <span>{t.settings.costVatSettings}</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.targetFoodCostPercent}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={form.targetFoodCostPercent || 30}
                  onChange={(e) =>
                    setForm({ ...form, targetFoodCostPercent: parseFloat(e.target.value) || 30 })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                />
                <span className="absolute right-3 top-2 text-xs font-bold text-neutral-400">%</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.vatPercent}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  required
                  value={form.vatPercent ?? 7}
                  onChange={(e) =>
                    setForm({ ...form, vatPercent: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                />
                <span className="absolute right-3 top-2 text-xs font-bold text-neutral-400">%</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.serviceChargePercent}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  required
                  value={form.serviceChargePercent ?? 10}
                  onChange={(e) =>
                    setForm({ ...form, serviceChargePercent: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                />
                <span className="absolute right-3 top-2 text-xs font-bold text-neutral-400">%</span>
              </div>
            </div>
          </div>

          {/* Daily closing time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-neutral-100">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-orange-600" />
                <span>{t.settings.dailyClosingTime}</span>
              </label>
              <input
                type="time"
                required
                value={form.dailyClosingTime || '04:00'}
                onChange={(e) => setForm({ ...form, dailyClosingTime: e.target.value })}
                className="px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
              />
              <p className="text-[11px] text-neutral-400 mt-1">{t.settings.dailyClosingTimeNote}</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.operatingDaysPerMonth}
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.operatingDaysPerMonth ?? 30}
                onChange={(e) =>
                  setForm({
                    ...form,
                    operatingDaysPerMonth: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 30)),
                  })
                }
                className="w-32 px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
              />
            </div>
          </div>

          {/* USALI Accounting Controls */}
          <div className="pt-3 border-t border-neutral-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Prices Include VAT */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(form.pricesIncludeVat)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pricesIncludeVat: e.target.checked,
                        serviceChargeIncludedInPrice: e.target.checked
                          ? Boolean(form.serviceChargeIncludedInPrice)
                          : false,
                      })
                    }
                    className="mt-0.5 w-4 h-4 accent-orange-600 rounded"
                  />
                  <div>
                    <span className="text-xs font-bold text-neutral-900 block">
                      {t.settings.pricesIncludeVat}
                    </span>
                    <span className="text-[11px] text-neutral-500 block mt-0.5">
                      {t.settings.pricesIncludeVatDesc}
                    </span>
                  </div>
                </label>

                {form.pricesIncludeVat && (
                  <label className="flex items-center gap-2 pl-6 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(form.serviceChargeIncludedInPrice)}
                      onChange={(e) =>
                        setForm({ ...form, serviceChargeIncludedInPrice: e.target.checked })
                      }
                      className="w-4 h-4 accent-orange-600 rounded"
                    />
                    <span className="text-xs font-semibold text-neutral-800">
                      {t.settings.serviceChargeIncludedInPrice}
                    </span>
                  </label>
                )}
              </div>

              {/* Commission VAT as Cost */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(form.commissionVatAsCost)}
                    onChange={(e) =>
                      setForm({ ...form, commissionVatAsCost: e.target.checked })
                    }
                    className="mt-0.5 w-4 h-4 accent-orange-600 rounded"
                  />
                  <div>
                    <span className="text-xs font-bold text-neutral-900 block">
                      {t.settings.commissionVatAsCost}
                    </span>
                    <span className="text-[11px] text-neutral-500 block mt-0.5">
                      {t.settings.commissionVatAsCostDesc}
                    </span>
                  </div>
                </label>

                <div className="pl-6 text-[11px] text-neutral-600">
                  <span className="font-bold">{t.settings.commissionBase}: </span>
                  <span>{t.settings.commissionBaseNetFood}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Service Charge Treatment */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.settings.serviceChargeTreatment}
                </label>
                <select
                  value={form.serviceChargeTreatment || 'staff_pool'}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      serviceChargeTreatment: e.target.value as 'staff_pool' | 'retained',
                    })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-semibold"
                >
                  <option value="staff_pool">{t.settings.serviceChargeStaffPool}</option>
                  <option value="retained">{t.settings.serviceChargeRetained}</option>
                </select>
              </div>

              {/* Suggested Price Rounding */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {t.settings.priceRounding}
                </label>
                <select
                  value={form.priceRounding || 5}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      priceRounding: (parseInt(e.target.value, 10) as 1 | 5 | 10) || 5,
                    })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-semibold"
                >
                  <option value={1}>{t.settings.priceRounding1}</option>
                  <option value={5}>{t.settings.priceRounding5}</option>
                  <option value={10}>{t.settings.priceRounding10}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* QR Payment Image Upload */}
        <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
          <h3 className="font-extrabold text-sm text-neutral-900 flex items-center gap-2">
            <QrCode className="w-4 h-4 text-blue-600" />
            <span>{t.settings.qrPaymentImage}</span>
          </h3>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            {qrDataUrl ? (
              <div className="p-2 bg-white rounded-2xl border border-neutral-200 shadow-xs">
                <img src={qrDataUrl} alt="QR Code" className="w-32 h-32 object-contain rounded-lg" />
              </div>
            ) : (
              <div className="w-32 h-32 rounded-2xl bg-neutral-100 border border-dashed border-neutral-300 flex items-center justify-center text-neutral-400 text-xs">
                No QR uploaded
              </div>
            )}

            <label className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer flex items-center gap-1.5">
              <Upload className="w-4 h-4 text-orange-600" />
              <span>{t.settings.uploadQrBtn}</span>
              <input type="file" accept="image/*" onChange={handleQrUpload} className="hidden" />
            </label>
          </div>
        </div>

        {/* Loyalty Points Configuration */}
        <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
          <h3 className="font-extrabold text-sm text-neutral-900 flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span>{t.settings.membersLoyalty}</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.pointsEarnUnitThb}
              </label>
              <input
                type="number"
                min={1}
                step={10}
                required
                value={form.pointsEarnUnitThb || 100}
                onChange={(e) =>
                  setForm({ ...form, pointsEarnUnitThb: parseFloat(e.target.value) || 100 })
                }
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.pointsRedeemValueThb}
              </label>
              <input
                type="number"
                min={0.1}
                step={0.5}
                required
                value={form.pointsRedeemValueThb || 1}
                onChange={(e) =>
                  setForm({ ...form, pointsRedeemValueThb: parseFloat(e.target.value) || 1 })
                }
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 active:scale-95 cursor-pointer hover:brightness-105 disabled:opacity-50 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? t.common.loading : t.common.save}</span>
          </button>
        </div>
      </form>

      {/* Daily Summaries Integrity Audit & Rebuild Section */}
      <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
        <div>
          <h3 className="font-extrabold text-sm text-neutral-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>{t.settings.rebuildSummariesTitle}</span>
          </h3>
          <p className="text-xs text-neutral-500 mt-1">{t.settings.rebuildSummariesDesc}</p>
        </div>

        {auditResult && (
          <div
            className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 border ${
              auditResult.isMatch
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-rose-50 border-rose-300 text-rose-800'
            }`}
          >
            {auditResult.isMatch ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{t.settings.auditSuccess}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  {t.settings.auditDiscrepancy} {auditResult.discrepantDates.join(', ')}
                </span>
              </>
            )}
          </div>
        )}

        {rebuildResult && (
          <div className="p-3 rounded-2xl text-xs font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{rebuildResult}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={isAuditing}
            onClick={handleRunAudit}
            className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold border border-neutral-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>{isAuditing ? 'Auditing...' : t.settings.auditCheckBtn}</span>
          </button>

          <button
            type="button"
            disabled={isRebuilding}
            onClick={handleRebuildSummaries}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 hover:brightness-105 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
            <span>{isRebuilding ? 'Rebuilding...' : t.settings.rebuildSummariesBtn}</span>
          </button>
        </div>
      </div>

      {/* USALI Accounting & Costing Formula Guide */}
      <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
        <button
          type="button"
          onClick={() => setShowFormulaGuide(!showFormulaGuide)}
          className="w-full flex items-center justify-between text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-orange-600 shrink-0" />
            <div>
              <h3 className="font-extrabold text-sm text-neutral-900">
                {t.settings.formulaGuideBtn}
              </h3>
              <p className="text-xs text-neutral-500">
                {lang === 'th'
                  ? 'คู่มืออธิบายสูตรและตัวอย่างตัวเลขจริงสำหรับตรวจสอบบัญชีด้วยตนเอง (USALI Standard)'
                  : 'Complete reference of every costing & P&L formula with worked numeric examples'}
              </p>
            </div>
          </div>
          {showFormulaGuide ? (
            <ChevronUp className="w-5 h-5 text-neutral-500 shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-500 shrink-0" />
          )}
        </button>

        {showFormulaGuide && (
          <div className="pt-3 border-t border-neutral-200 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs select-text">
            {/* 1. EP Cost & Cost Method */}
            <div className="p-3.5 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-1.5">
              <div className="font-black text-neutral-900">
                {lang === 'th'
                  ? '1. ต้นทุนวัตถุดิบที่ใช้ได้จริง (EP Cost & Cost Method)'
                  : '1. Edible Portion (EP) Ingredient Cost'}
              </div>
              <div className="font-mono text-[11px] bg-white p-2 rounded-lg border border-neutral-200 text-neutral-800">
                EP Cost = Purchase Price / (Qty × Unit Multiplier × Yield%)
              </div>
              <p className="text-[11px] text-neutral-600">
                {lang === 'th'
                  ? 'ตัวอย่าง: ซื้อเนื้อวัว 1 kg (1,000 g) ราคา 300 บาท, Yield 80% → ต้นทุนจริง = 300 ÷ (1,000 × 0.80) = 0.375 บาท/กรัม (โหมด Average จะเฉลี่ยจากประวัติราคาล่าสุด 3 ครั้ง)'
                  : 'Example: Beef 1 kg (1,000 g) at ฿300 with 80% yield → 300 ÷ (1,000 × 0.80) = ฿0.375/g. Average mode averages the last 3 price history entries.'}
              </p>
            </div>

            {/* 2. Food COGS vs Packaging & Suggested Price */}
            <div className="p-3.5 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-1.5">
              <div className="font-black text-neutral-900">
                {lang === 'th'
                  ? '2. แยกต้นทุนอาหารกับบรรจุภัณฑ์ & ราคาขายแนะนำ'
                  : '2. Food COGS vs Packaging & Suggested Price'}
              </div>
              <div className="font-mono text-[11px] bg-white p-2 rounded-lg border border-neutral-200 text-neutral-800">
                Net Price = Food Cost / (Target% / 100)
                <br />
                Menu Price = RoundUp(Net × (1 + VAT%), Step)
              </div>
              <p className="text-[11px] text-neutral-600">
                {lang === 'th'
                  ? 'ตัวอย่าง: Food COGS = 45 บาท, เป้าหมาย 30% → ราคาสุทธิแนะนำ = 45 ÷ 0.30 = 150 บาท ถ้ารวม VAT 7% = 160.50 → ปัดขึ้นทีละ 5 บาท = 165 บาท (บรรจุภัณฑ์ไม่รวมในทานที่ร้าน)'
                  : 'Example: Food Cost = ฿45, Target 30% → Suggested Net = 45 ÷ 0.30 = ฿150. If VAT-inclusive (7%): 150 × 1.07 = ฿160.50 → Rounded UP to nearest 5 = ฿165.'}
              </p>
            </div>

            {/* 3. Channel Markup & Platform Commission */}
            <div className="p-3.5 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-1.5">
              <div className="font-black text-neutral-900">
                {lang === 'th'
                  ? '3. ราคาตามช่องทางขาย และค่าคอมมิชชันแพลตฟอร์ม'
                  : '3. Channel Markup & Platform Commission'}
              </div>
              <div className="font-mono text-[11px] bg-white p-2 rounded-lg border border-neutral-200 text-neutral-800">
                Channel Price = Base Price × (1 + Markup%)
                <br />
                Commission = Net Food Sales × GP% (× 1.07 if Commission VAT)
              </div>
              <p className="text-[11px] text-neutral-600">
                {lang === 'th'
                  ? 'ตัวอย่าง: ราคาหน้าร้าน 100 บาท + Markup 20% = 120 บาท, ค่าคอม GP 30% ของยอดสุทธิ = 36 บาท (ถ้าคิด VAT 7% ของค่าคอมเป็นต้นทุน = 36 × 1.07 = 38.52 บาท)'
                  : 'Example: Base ฿100 with 20% markup = ฿120. At 30% GP = ฿36 commission (or ฿36 × 1.07 = ฿38.52 if 7% VAT on commission is enabled).'}
              </p>
            </div>

            {/* 4. Theoretical Food Cost % & Item CM */}
            <div className="p-3.5 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-1.5">
              <div className="font-black text-neutral-900">
                {lang === 'th'
                  ? '4. ต้นทุนอาหารตามทฤษฎี % และกำไรส่วนเกินต่อจาน (CM)'
                  : '4. Theoretical Food Cost % & Item Contribution Margin'}
              </div>
              <div className="font-mono text-[11px] bg-white p-2 rounded-lg border border-neutral-200 text-neutral-800">
                Food Cost % = (Food COGS / Net Sales) × 100
                <br />
                CM = Net Price - Food Cost - Packaging - Commission
              </div>
              <p className="text-[11px] text-neutral-600">
                {lang === 'th'
                  ? 'ตัวอย่าง: ขายสุทธิ 150 บาท, ต้นทุนอาหาร 45 บาท, กล่อง 5 บาท → Food Cost % = 30.0%, กำไรส่วนเกิน CM = 150 - 45 - 5 = 100 บาท (CM% = 66.7%)'
                  : 'Example: Net Price ฿150, Food Cost ฿45, Packaging ฿5 → Food Cost % = 30.0%, Item CM = 150 - 45 - 5 = ฿100 (66.7%).'}
              </p>
            </div>

            {/* 5. USALI Income Statement & Prime Cost */}
            <div className="p-3.5 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-1.5">
              <div className="font-black text-neutral-900">
                {lang === 'th'
                  ? '5. งบกำไรขาดทุน USALI และ Prime Cost %'
                  : '5. USALI P&L & Prime Cost Benchmark'}
              </div>
              <div className="font-mono text-[11px] bg-white p-2 rounded-lg border border-neutral-200 text-neutral-800">
                Gross Profit = Net Sales - Food COGS (+ Retained SC)
                <br />
                Prime Cost = Food COGS + Labor (Target ≤ 65%, Labor ≤ 30%)
                <br />
                NOP = Gross Profit - Packaging - GP - Labor - OpEx
              </div>
              <p className="text-[11px] text-neutral-600">
                {lang === 'th'
                  ? 'ตัวอย่าง: ยอดสุทธิ 300,000, Food COGS 90,000 (30%), ค่าแรง 75,000 (25%) → กำไรขั้นต้น 210,000 (70%), Prime Cost = 165,000 (55% อยู่ในเกณฑ์ดี), หักกล่อง/GP/ค่าเช่า = NOP'
                  : 'Example: Net Sales ฿300,000, Food COGS ฿90,000 (30%), Labor ฿75,000 (25%) → Gross Profit ฿210,000 (70%), Prime Cost = ฿165,000 (55% Healthy).'}
              </p>
            </div>

            {/* 6. Real-Data Break-Even & Period Allocation */}
            <div className="p-3.5 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-1.5">
              <div className="font-black text-neutral-900">
                {lang === 'th'
                  ? '6. จุดคุ้มทุนจากข้อมูลจริง 30 วัน & การปันส่วนรายวัน/ปี'
                  : '6. 30-Day Break-Even & Period Cost Allocation'}
              </div>
              <div className="font-mono text-[11px] bg-white p-2 rounded-lg border border-neutral-200 text-neutral-800">
                Var Cost % = (Food + Packaging + GP) / Net Sales (30d)
                <br />
                Monthly Break-Even = (Fixed OpEx + Labor) / (1 - Var%)
                <br />
                Daily Break-Even = Monthly Break-Even / Operating Days
              </div>
              <p className="text-[11px] text-neutral-600">
                {lang === 'th'
                  ? 'ตัวอย่าง: ต้นทุนผันแปร 30 วัน = 38% → CM% = 62%, ค่าเช่า+ค่าแรง = 124,000 → จุดคุ้มทุนเดือนละ 200,000 บาท (วันละ 200,000 ÷ 30 = 6,666.67 บาท) ค่าใช้จ่ายรายวันหารด้วยจำนวนวันจริงของเดือนนั้น'
                  : 'Example: 30-day Variable Cost = 38% → CM = 62%. Fixed+Labor = ฿124,000 → Monthly Break-Even = 124,000 ÷ 0.62 = ฿200,000 (Daily ÷ 30 days = ฿6,666.67). Daily OpEx divides by real days in that month.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
