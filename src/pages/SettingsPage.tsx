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
    </div>
  );
};
