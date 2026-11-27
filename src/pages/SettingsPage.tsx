import React, { useState, useEffect, useRef } from 'react';
import {
  SettingsDoc,
  Language,
  DishDoc,
  OptionGroupDoc,
  CategoryDoc,
  ChannelDoc,
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
} from '../types';
import { translations } from '../i18n/translations';
import { useLanguage } from '../contexts/LanguageContext';
import {
  auth,
  updateSettings,
  saveImageDoc,
  getImageDoc,
  rebuildSummariesFromBills,
  auditSummariesAgainstBills,
  fetchCollection,
  saveDocument,
} from '../data/db';
import { compressImage } from '../utils/imageCompressor';
import { PWAInstallButton } from '../components/PWAInstallButton';
import {
  MenuItem as CostMenuItem,
  Ingredient as CostIngredient,
  Sauce as CostSauce,
} from '../costing/types';
import { COST_COLLECTIONS, FirebaseSyncService } from '../costing/services/firebaseSyncService';
import { StorageService } from '../costing/services/storageService';
import {
  buildRetranslatePreview,
  RetranslateEntityType,
  RetranslatePreviewItem,
} from '../utils/retranslateScanner';
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
  Languages,
  X,
  RotateCcw,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import { NumericInput } from '../costing/components/common/NumericInput';
import { ConfirmModal } from '../components/ConfirmModal';
import { FoodDictionaryModal } from '../components/FoodDictionaryModal';
import {
  getShopTranslationGlossary,
  subscribeShopTranslationGlossary,
  getBuiltInFoodDictionary,
} from '../utils/thaiToEnglish';

interface Props {
  settings: SettingsDoc;
  lang?: Language;
  onSettingsUpdated: (newSettings: SettingsDoc) => void;
}

export const SettingsPage: React.FC<Props> = ({
  settings,
  lang: propLang,
  onSettingsUpdated,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const t = translations[lang];

  const [form, setForm] = useState<SettingsDoc>({ ...settings });
  const [showFormulaGuide, setShowFormulaGuide] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [isUpdatingLogo, setIsUpdatingLogo] = useState(false);
  const [logoStatusMsg, setLogoStatusMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audit and rebuild states
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<{ isMatch: boolean; discrepantDates: string[] } | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);
  const [isRebuildConfirmOpen, setIsRebuildConfirmOpen] = useState(false);

  // Batch re-translation state (R7)
  const [isScanningTranslations, setIsScanningTranslations] = useState(false);
  const [isApplyingTranslations, setIsApplyingTranslations] = useState(false);
  const [isRetranslateModalOpen, setIsRetranslateModalOpen] = useState(false);
  const [retranslateItems, setRetranslateItems] = useState<RetranslatePreviewItem[]>([]);
  const [retranslateStats, setRetranslateStats] = useState<{
    skippedManualCount: number;
    unresolvedCount: number;
  }>({ skippedManualCount: 0, unresolvedCount: 0 });
  const [retranslateFeedback, setRetranslateFeedback] = useState<string | null>(null);
  const [isDictionaryModalOpen, setIsDictionaryModalOpen] = useState(false);
  const [customDictCount, setCustomDictCount] = useState<number>(
    () => Object.keys(getShopTranslationGlossary()).length
  );
  const builtInDictCount = getBuiltInFoodDictionary().length;
  const lastAutoSyncedLogoVersionRef = useRef<number | null>(null);
  const loadedDatasetRef = useRef<{
    dishes: DishDoc[];
    optionGroups: OptionGroupDoc[];
    categories: CategoryDoc[];
    channels: ChannelDoc[];
    ingredients: IngredientDoc[];
    subRecipes: SubRecipeDoc[];
    packaging: PackagingDoc[];
    costMenus: CostMenuItem[];
    costIngredients: CostIngredient[];
    costSauces: CostSauce[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (
      lastAutoSyncedLogoVersionRef.current !== null &&
      settings.version === lastAutoSyncedLogoVersionRef.current
    ) {
      setForm((prev) => ({
        ...prev,
        logoImageId: settings.logoImageId,
        version: settings.version,
        updatedAt: settings.updatedAt,
      }));
    } else {
      lastAutoSyncedLogoVersionRef.current = null;
      setForm({ ...settings });
    }

    if (settings.qrImageId) {
      getImageDoc(settings.qrImageId).then((img) => {
        if (!cancelled && img?.dataUrl) setQrDataUrl(img.dataUrl);
      });
    } else {
      setQrDataUrl(null);
    }

    if (settings.logoImageId) {
      getImageDoc(settings.logoImageId).then((img) => {
        if (!cancelled) {
          setLogoDataUrl(img?.dataUrl || null);
        }
      });
    } else {
      setLogoDataUrl(null);
    }

    return () => {
      cancelled = true;
    };
  }, [settings]);

  useEffect(() => {
    setCustomDictCount(Object.keys(getShopTranslationGlossary()).length);
    return subscribeShopTranslationGlossary((entries) => {
      setCustomDictCount(Object.keys(entries).length);
    });
  }, []);

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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUpdatingLogo(true);
    setLogoStatusMsg(null);
    setErrorMsg(null);
    try {
      const { dataUrl, sizeBytes } = await compressImage(file);
      const imgId = `logo_${Date.now()}`;
      await saveImageDoc(imgId, dataUrl, sizeBytes);

      const nextVersion = settings.version + 1;
      const nowIso = new Date().toISOString();
      lastAutoSyncedLogoVersionRef.current = nextVersion;

      await updateSettings({ logoImageId: imgId }, settings.version);
      setLogoDataUrl(dataUrl);
      setForm((prev) => ({
        ...prev,
        logoImageId: imgId,
        version: nextVersion,
        updatedAt: nowIso,
      }));
      onSettingsUpdated({
        ...settings,
        logoImageId: imgId,
        version: nextVersion,
        updatedAt: nowIso,
      });
      setLogoStatusMsg(
        lang === 'th'
          ? 'อัปโหลดและเปลี่ยนโลโก้ร้านเรียบร้อยแล้ว (ซิงค์ขึ้นหน้าลูกค้าอัตโนมัติ)'
          : 'Store logo updated and synced to customer storefront.'
      );
    } catch (err: unknown) {
      lastAutoSyncedLogoVersionRef.current = null;
      console.error('Logo upload error:', err);
      setErrorMsg(
        err instanceof Error && err.message === 'VERSION_CONFLICT'
          ? t.common.versionConflict
          : lang === 'th'
          ? 'อัปโหลดโลโก้ร้านไม่สำเร็จ'
          : 'Failed to upload store logo'
      );
    } finally {
      setIsUpdatingLogo(false);
    }
  };

  const handleResetLogo = async () => {
    setIsUpdatingLogo(true);
    setLogoStatusMsg(null);
    setErrorMsg(null);
    try {
      const nextVersion = settings.version + 1;
      const nowIso = new Date().toISOString();
      lastAutoSyncedLogoVersionRef.current = nextVersion;

      await updateSettings({ logoImageId: '' }, settings.version);
      setLogoDataUrl(null);
      setForm((prev) => ({
        ...prev,
        logoImageId: '',
        version: nextVersion,
        updatedAt: nowIso,
      }));
      onSettingsUpdated({
        ...settings,
        logoImageId: '',
        version: nextVersion,
        updatedAt: nowIso,
      });
      setLogoStatusMsg(
        lang === 'th'
          ? 'เปลี่ยนกลับเป็นโลโก้เริ่มต้นเรียบร้อยแล้ว'
          : 'Reverted to default store logo.'
      );
    } catch (err: unknown) {
      lastAutoSyncedLogoVersionRef.current = null;
      console.error('Logo reset error:', err);
      setErrorMsg(
        err instanceof Error && err.message === 'VERSION_CONFLICT'
          ? t.common.versionConflict
          : lang === 'th'
          ? 'รีเซ็ตโลโก้ร้านไม่สำเร็จ'
          : 'Failed to reset store logo'
      );
    } finally {
      setIsUpdatingLogo(false);
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
          : lang === 'th'
          ? 'บันทึกการตั้งค่าไม่สำเร็จ'
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

  const handleConfirmRebuildSummaries = async () => {
    setIsRebuildConfirmOpen(false);
    setIsRebuilding(true);
    setAuditResult(null);
    try {
      const res = await rebuildSummariesFromBills();
      setRebuildResult(
        lang === 'th'
          ? `ประมวลผลสรุปรายวันใหม่สำเร็จ ${res.rebuiltCount} วัน`
          : `Rebuilt ${res.rebuiltCount} daily summaries successfully.`
      );
    } catch (err) {
      console.error('Rebuild error:', err);
    } finally {
      setIsRebuilding(false);
    }
  };

  const getEntityTypeLabel = (entityType: RetranslateEntityType): string => {
    const labels: Record<RetranslateEntityType, { th: string; en: string }> = {
      dish: { th: 'เมนู (POS)', en: 'Dish (POS)' },
      dishVariant: { th: 'ตัวเลือกหลัก (POS)', en: 'Variant (POS)' },
      optionGroup: { th: 'กลุ่มตัวเลือกย่อย', en: 'Option Group' },
      optionChoice: { th: 'ตัวเลือกย่อย', en: 'Option Choice' },
      category: { th: 'หมวดหมู่เมนู', en: 'Category' },
      channel: { th: 'ช่องทางขาย', en: 'Sales Channel' },
      ingredient: { th: 'วัตถุดิบ (POS)', en: 'Ingredient (POS)' },
      subRecipe: { th: 'สูตรย่อย (POS)', en: 'Sub-Recipe (POS)' },
      packaging: { th: 'บรรจุภัณฑ์ (POS)', en: 'Packaging (POS)' },
      costMenu: { th: 'เมนู (ต้นทุน)', en: 'Menu (Costing)' },
      costVariant: { th: 'ตัวเลือก (ต้นทุน)', en: 'Variant (Costing)' },
      costIngredient: { th: 'วัตถุดิบ (ต้นทุน)', en: 'Ingredient (Costing)' },
      costSauce: { th: 'ซอส/พริกแกง (ต้นทุน)', en: 'Sauce (Costing)' },
    };
    return labels[entityType]?.[lang] || entityType;
  };

  const handleScanRetranslations = async () => {
    setIsScanningTranslations(true);
    setRetranslateFeedback(null);
    try {
      const safeFetch = async <T,>(colName: string): Promise<T[]> => {
        try {
          return await fetchCollection<T>(colName);
        } catch {
          return [];
        }
      };

      const [
        dishes,
        optionGroups,
        categories,
        channels,
        ingredients,
        subRecipes,
        packaging,
        cloudCostMenus,
        cloudCostIngredients,
        cloudCostSauces,
      ] = await Promise.all([
        safeFetch<DishDoc>('dishes'),
        safeFetch<OptionGroupDoc>('optionGroups'),
        safeFetch<CategoryDoc>('categories'),
        safeFetch<ChannelDoc>('channels'),
        safeFetch<IngredientDoc>('ingredients'),
        safeFetch<SubRecipeDoc>('subRecipes'),
        safeFetch<PackagingDoc>('packaging'),
        safeFetch<CostMenuItem>(COST_COLLECTIONS.MENUS),
        safeFetch<CostIngredient>(COST_COLLECTIONS.INGREDIENTS),
        safeFetch<CostSauce>(COST_COLLECTIONS.SAUCES),
      ]);

      const costMenus =
        cloudCostMenus.length > 0 ? cloudCostMenus : StorageService.getMenus();
      const costIngredients =
        cloudCostIngredients.length > 0 ? cloudCostIngredients : StorageService.getIngredients();
      const costSauces =
        cloudCostSauces.length > 0 ? cloudCostSauces : StorageService.getSauces();

      const dataset = {
        dishes,
        optionGroups,
        categories,
        channels,
        ingredients,
        subRecipes,
        packaging,
        costMenus,
        costIngredients,
        costSauces,
      };
      loadedDatasetRef.current = dataset;

      const scanResult = buildRetranslatePreview(dataset);
      setRetranslateItems(scanResult.items);
      setRetranslateStats({
        skippedManualCount: scanResult.skippedManualCount,
        unresolvedCount: scanResult.unresolvedCount,
      });
      setIsRetranslateModalOpen(true);
    } catch (err) {
      console.error('Failed to scan translations:', err);
      setRetranslateFeedback(
        lang === 'th'
          ? 'ไม่สามารถสแกนรายการแปลภาษาได้ในขณะนี้'
          : 'Failed to scan translations.'
      );
    } finally {
      setIsScanningTranslations(false);
    }
  };

  const handleApplyRetranslations = async () => {
    const dataset = loadedDatasetRef.current;
    if (!dataset || retranslateItems.length === 0) {
      setIsRetranslateModalOpen(false);
      return;
    }

    setIsApplyingTranslations(true);
    try {
      const uid = auth?.currentUser?.uid;

      const dishUpdates = new Map<string, string>();
      const dishVariantUpdates = new Map<string, Map<string, string>>();
      const optionGroupUpdates = new Map<string, string>();
      const optionChoiceUpdates = new Map<string, Map<string, string>>();
      const categoryUpdates = new Map<string, string>();
      const channelUpdates = new Map<string, string>();
      const ingredientUpdates = new Map<string, string>();
      const subRecipeUpdates = new Map<string, string>();
      const packagingUpdates = new Map<string, string>();
      const costMenuUpdates = new Map<string, string>();
      const costVariantUpdates = new Map<string, Map<string, string>>();
      const costIngredientUpdates = new Map<string, string>();
      const costSauceUpdates = new Map<string, string>();

      for (const item of retranslateItems) {
        switch (item.entityType) {
          case 'dish':
            dishUpdates.set(item.id, item.newEnglish);
            break;
          case 'dishVariant': {
            if (!item.parentId) break;
            const m = dishVariantUpdates.get(item.parentId) || new Map<string, string>();
            m.set(item.id, item.newEnglish);
            dishVariantUpdates.set(item.parentId, m);
            break;
          }
          case 'optionGroup':
            optionGroupUpdates.set(item.id, item.newEnglish);
            break;
          case 'optionChoice': {
            if (!item.parentId) break;
            const m = optionChoiceUpdates.get(item.parentId) || new Map<string, string>();
            m.set(item.id, item.newEnglish);
            optionChoiceUpdates.set(item.parentId, m);
            break;
          }
          case 'category':
            categoryUpdates.set(item.id, item.newEnglish);
            break;
          case 'channel':
            channelUpdates.set(item.id, item.newEnglish);
            break;
          case 'ingredient':
            ingredientUpdates.set(item.id, item.newEnglish);
            break;
          case 'subRecipe':
            subRecipeUpdates.set(item.id, item.newEnglish);
            break;
          case 'packaging':
            packagingUpdates.set(item.id, item.newEnglish);
            break;
          case 'costMenu':
            costMenuUpdates.set(item.id, item.newEnglish);
            break;
          case 'costVariant': {
            if (!item.parentId) break;
            const m = costVariantUpdates.get(item.parentId) || new Map<string, string>();
            m.set(item.id, item.newEnglish);
            costVariantUpdates.set(item.parentId, m);
            break;
          }
          case 'costIngredient':
            costIngredientUpdates.set(item.id, item.newEnglish);
            break;
          case 'costSauce':
            costSauceUpdates.set(item.id, item.newEnglish);
            break;
        }
      }

      const saveTasks: Promise<unknown>[] = [];

      for (const dish of dataset.dishes) {
        const newDishName = dishUpdates.get(dish.id);
        const varMap = dishVariantUpdates.get(dish.id);
        if (!newDishName && !varMap) continue;
        const updatedDish: DishDoc = {
          ...dish,
          ...(newDishName ? { name: newDishName, nameEnManual: false } : {}),
          variants: (dish.variants || []).map((v) => {
            const nextVarEn = varMap?.get(v.id);
            return nextVarEn ? { ...v, name: nextVarEn, nameEnManual: false } : v;
          }),
        };
        saveTasks.push(saveDocument('dishes', updatedDish, false));
      }

      for (const grp of dataset.optionGroups) {
        const newGrpName = optionGroupUpdates.get(grp.id);
        const choiceMap = optionChoiceUpdates.get(grp.id);
        if (!newGrpName && !choiceMap) continue;
        const updatedGrp: OptionGroupDoc = {
          ...grp,
          ...(newGrpName ? { name: newGrpName, nameEnManual: false } : {}),
          choices: (grp.choices || []).map((c) => {
            const nextChoiceEn = choiceMap?.get(c.id);
            return nextChoiceEn ? { ...c, name: nextChoiceEn, nameEnManual: false } : c;
          }),
        };
        saveTasks.push(saveDocument('optionGroups', updatedGrp, false));
      }

      for (const cat of dataset.categories) {
        const nextEn = categoryUpdates.get(cat.id);
        if (!nextEn) continue;
        saveTasks.push(
          saveDocument('categories', { ...cat, name: nextEn, nameEnManual: false }, false)
        );
      }

      for (const ch of dataset.channels) {
        const nextEn = channelUpdates.get(ch.id);
        if (!nextEn) continue;
        saveTasks.push(
          saveDocument('channels', { ...ch, name: nextEn, nameEnManual: false }, false)
        );
      }

      for (const ing of dataset.ingredients) {
        const nextEn = ingredientUpdates.get(ing.id);
        if (!nextEn) continue;
        saveTasks.push(
          saveDocument('ingredients', { ...ing, name: nextEn, nameEnManual: false }, false)
        );
      }

      for (const sub of dataset.subRecipes) {
        const nextEn = subRecipeUpdates.get(sub.id);
        if (!nextEn) continue;
        saveTasks.push(
          saveDocument('subRecipes', { ...sub, name: nextEn, nameEnManual: false }, false)
        );
      }

      for (const pkg of dataset.packaging) {
        const nextEn = packagingUpdates.get(pkg.id);
        if (!nextEn) continue;
        saveTasks.push(
          saveDocument('packaging', { ...pkg, name: nextEn, nameEnManual: false }, false)
        );
      }

      if (costMenuUpdates.size > 0 || costVariantUpdates.size > 0) {
        const updatedMenus = dataset.costMenus.map((cm) => {
          const newMenuEn = costMenuUpdates.get(cm.id);
          const varMap = costVariantUpdates.get(cm.id);
          if (!newMenuEn && !varMap) return cm;
          const nextMenu: CostMenuItem = {
            ...cm,
            ...(newMenuEn ? { englishName: newMenuEn, englishNameManual: false } : {}),
            variants: (cm.variants || []).map((cv) => {
              const nextVarEn = varMap?.get(cv.id);
              return nextVarEn
                ? { ...cv, englishName: nextVarEn, englishNameManual: false }
                : cv;
            }),
            updatedAt: new Date().toISOString(),
          };
          if (uid) {
            saveTasks.push(
              FirebaseSyncService.saveUserDoc(uid, COST_COLLECTIONS.MENUS, nextMenu.id, nextMenu)
            );
          }
          return nextMenu;
        });
        StorageService.saveMenus(updatedMenus);
      }

      if (costIngredientUpdates.size > 0) {
        const updatedIngs = dataset.costIngredients.map((ci) => {
          const nextEn = costIngredientUpdates.get(ci.id);
          if (!nextEn) return ci;
          const nextIng: CostIngredient = {
            ...ci,
            englishName: nextEn,
            englishNameManual: false,
            updatedAt: new Date().toISOString(),
          };
          if (uid) {
            saveTasks.push(
              FirebaseSyncService.saveUserDoc(
                uid,
                COST_COLLECTIONS.INGREDIENTS,
                nextIng.id,
                nextIng
              )
            );
          }
          return nextIng;
        });
        StorageService.saveIngredients(updatedIngs);
      }

      if (costSauceUpdates.size > 0) {
        const updatedSauces = dataset.costSauces.map((cs) => {
          const nextEn = costSauceUpdates.get(cs.id);
          if (!nextEn) return cs;
          const nextSauce: CostSauce = {
            ...cs,
            englishName: nextEn,
            englishNameManual: false,
            updatedAt: new Date().toISOString(),
          };
          if (uid) {
            saveTasks.push(
              FirebaseSyncService.saveUserDoc(uid, COST_COLLECTIONS.SAUCES, nextSauce.id, nextSauce)
            );
          }
          return nextSauce;
        });
        StorageService.saveSauces(updatedSauces);
      }

      await Promise.all(saveTasks);

      const appliedCount = retranslateItems.length;
      setIsRetranslateModalOpen(false);
      setRetranslateItems([]);
      setRetranslateFeedback(
        lang === 'th'
          ? `อัปเดตชื่อภาษาอังกฤษสำเร็จ ${appliedCount} รายการ`
          : `Updated English translations for ${appliedCount} items.`
      );
    } catch (err) {
      console.error('Failed to apply re-translations:', err);
      setRetranslateFeedback(
        lang === 'th'
          ? 'บันทึกการอัปเดตชื่อภาษาอังกฤษไม่สำเร็จ'
          : 'Failed to save updated English names.'
      );
    } finally {
      setIsApplyingTranslations(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6 select-none">
      <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
        <Settings className="w-6 h-6 text-neutral-700" />
        <span>{t.settings.title}</span>
      </h2>

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

          {/* Storefront Logo Upload / Change / Reset */}
          <div className="pt-3 border-t border-neutral-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-800">
                <ImageIcon className="w-4 h-4 text-orange-600" />
                <span>{t.settings.storeLogo}</span>
              </div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-600">
                {form.logoImageId
                  ? lang === 'th'
                    ? 'โลโก้ที่อัปโหลดเอง'
                    : 'Custom Logo'
                  : lang === 'th'
                  ? 'โลโก้เริ่มต้น'
                  : 'Default Logo'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-white border-2 border-orange-200 shadow-xs overflow-hidden flex items-center justify-center shrink-0">
                <img
                  src={logoDataUrl || './assets/aistudio/Logo-Ex_a8e2a318.png'}
                  alt={lang === 'th' ? 'ตัวอย่างโลโก้ร้าน' : 'Store Logo Preview'}
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="space-y-2 flex-1 min-w-0">
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  {t.settings.storeLogoDesc}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={`px-3.5 py-2 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-xl text-xs font-bold border border-orange-200 inline-flex items-center gap-1.5 transition-colors ${
                      isUpdatingLogo ? 'opacity-60 pointer-events-none' : 'cursor-pointer'
                    }`}
                  >
                    {isUpdatingLogo ? (
                      <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
                    ) : (
                      <Upload className="w-4 h-4 text-orange-600" />
                    )}
                    <span>
                      {form.logoImageId ? t.settings.changeLogoBtn : t.settings.uploadLogoBtn}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={isUpdatingLogo}
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>

                  {form.logoImageId && (
                    <button
                      type="button"
                      disabled={isUpdatingLogo}
                      onClick={handleResetLogo}
                      className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{t.settings.resetLogoBtn}</span>
                    </button>
                  )}
                </div>
                {logoStatusMsg && (
                  <p className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{logoStatusMsg}</span>
                  </p>
                )}
              </div>
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
                <NumericInput
                  min={1}
                  max={100}
                  value={form.targetFoodCostPercent}
                  onValueChange={(val) =>
                    setForm({ ...form, targetFoodCostPercent: val })
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
                <NumericInput
                  min={0}
                  max={30}
                  step={0.5}
                  value={form.vatPercent}
                  onValueChange={(val) =>
                    setForm({ ...form, vatPercent: val })
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
                <NumericInput
                  min={0}
                  max={30}
                  step={0.5}
                  value={form.serviceChargePercent}
                  onValueChange={(val) =>
                    setForm({ ...form, serviceChargePercent: val })
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
              <NumericInput
                min={1}
                max={31}
                value={form.operatingDaysPerMonth}
                onValueChange={(val) =>
                  setForm({
                    ...form,
                    operatingDaysPerMonth: val <= 0 ? 0 : Math.min(31, Math.round(val)),
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  {lang === 'th' ? 'อัตราภาษีเงินได้ประมาณการ (%)' : 'Estimated Income Tax Rate (%)'}
                </label>
                <div className="relative">
                  <NumericInput
                    min={0}
                    max={50}
                    step={0.5}
                    value={form.incomeTaxRatePercent ?? 20}
                    onValueChange={(val) =>
                      setForm({
                        ...form,
                        incomeTaxRatePercent: Number.isFinite(val) ? Math.max(0, Math.min(50, val)) : 20,
                      })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                  />
                  <span className="absolute right-3 top-2 text-xs font-bold text-neutral-400">%</span>
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">
                  {lang === 'th' ? 'ประมาณการ — โปรดยืนยันกับนักบัญชี' : 'Estimate — please confirm with your accountant'}
                </p>
              </div>

              {/* Employer Social Security (Optional) */}
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(form.socialSecurityEnabled)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        socialSecurityEnabled: e.target.checked,
                        socialSecurityRatePercent: form.socialSecurityRatePercent ?? 5,
                        socialSecurityCapWage: form.socialSecurityCapWage ?? 15000,
                      })
                    }
                    className="mt-0.5 w-4 h-4 accent-orange-600 rounded"
                  />
                  <div>
                    <span className="text-xs font-bold text-neutral-900 block">
                      {lang === 'th'
                        ? 'รวมเงินสมทบประกันสังคมนายจ้าง (Employer SSO)'
                        : 'Include Employer Social Security'}
                    </span>
                    <span className="text-[11px] text-neutral-500 block mt-0.5">
                      {lang === 'th'
                        ? 'ค่าเริ่มต้น 5% เพดานฐานเงินเดือน 15,000 บาท (สูงสุด 750 บาท/คน/เดือน)'
                        : 'Default 5% capped at ฿15,000 base wage (max ฿750/mo)'}
                    </span>
                  </div>
                </label>

                {form.socialSecurityEnabled && (
                  <div className="grid grid-cols-2 gap-2 pl-6 pt-1">
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-600 mb-0.5">
                        {lang === 'th' ? 'อัตรา (%)' : 'Rate (%)'}
                      </label>
                      <NumericInput
                        min={0}
                        max={20}
                        step={0.5}
                        value={form.socialSecurityRatePercent ?? 5}
                        onValueChange={(val) =>
                          setForm({
                            ...form,
                            socialSecurityRatePercent: Number.isFinite(val) ? Math.max(0, Math.min(20, val)) : 5,
                          })
                        }
                        className="w-full px-2.5 py-1 text-xs bg-white border border-neutral-300 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-600 mb-0.5">
                        {lang === 'th' ? 'เพดานค่าจ้าง (บาท)' : 'Wage Cap (THB)'}
                      </label>
                      <NumericInput
                        min={0}
                        max={100000}
                        step={500}
                        value={form.socialSecurityCapWage ?? 15000}
                        onValueChange={(val) =>
                          setForm({
                            ...form,
                            socialSecurityCapWage: Number.isFinite(val) ? Math.max(0, val) : 15000,
                          })
                        }
                        className="w-full px-2.5 py-1 text-xs bg-white border border-neutral-300 rounded-lg font-bold"
                      />
                    </div>
                  </div>
                )}
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
              <div className="w-32 h-32 rounded-2xl bg-neutral-100 border border-dashed border-neutral-300 flex items-center justify-center text-neutral-400 text-xs text-center px-2">
                {lang === 'th' ? 'ยังไม่ได้อัปโหลด QR' : 'No QR uploaded'}
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
              <NumericInput
                min={1}
                step={10}
                value={form.pointsEarnUnitThb}
                onValueChange={(val) =>
                  setForm({ ...form, pointsEarnUnitThb: val })
                }
                className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                {t.settings.pointsRedeemValueThb}
              </label>
              <NumericInput
                min={0.1}
                step={0.5}
                value={form.pointsRedeemValueThb}
                onValueChange={(val) =>
                  setForm({ ...form, pointsRedeemValueThb: val })
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
        <h3 className="font-extrabold text-sm text-neutral-900 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <span>{t.settings.rebuildSummariesTitle}</span>
        </h3>

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
            <span>{isAuditing ? (lang === 'th' ? 'กำลังตรวจสอบ...' : 'Auditing...') : t.settings.auditCheckBtn}</span>
          </button>

          <button
            type="button"
            disabled={isRebuilding}
            onClick={() => setIsRebuildConfirmOpen(true)}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 hover:brightness-105 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
            <span>
              {isRebuilding
                ? lang === 'th'
                  ? 'กำลังประมวลผลใหม่...'
                  : 'Rebuilding...'
                : t.settings.rebuildSummariesBtn}
            </span>
          </button>
        </div>
      </div>

      {/* Batch Re-translate Auto-Generated English Names (R7) */}
      <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold text-sm text-neutral-900 flex items-center gap-2">
              <Languages className="w-5 h-5 text-orange-600 shrink-0" />
              <span>
                {lang === 'th'
                  ? 'แปลชื่อภาษาอังกฤษที่สร้างอัตโนมัติใหม่'
                  : 'Re-translate auto-generated names'}
              </span>
            </h3>
            <p className="text-[11px] text-neutral-500 mt-1">
              {lang === 'th'
                ? 'สแกนเมนู ตัวเลือก กลุ่มตัวเลือก หมวดหมู่ วัตถุดิบ และซอส โดยคงชื่อภาษาอังกฤษที่คุณแก้ไขเองไว้ทั้งหมด'
                : 'Scan menus, variants, options, categories, ingredients, and sauces while preserving manually edited English names.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsDictionaryModalOpen(true)}
              className="px-4 py-2 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-xl text-xs font-bold border border-orange-300 flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <BookOpen className="w-3.5 h-3.5 text-orange-600" />
              <span>
                {lang === 'th'
                  ? `พจนานุกรมอาหาร (${builtInDictCount + customDictCount})`
                  : `Food Dictionary (${builtInDictCount + customDictCount})`}
              </span>
            </button>
            <button
              type="button"
              disabled={isScanningTranslations}
              onClick={handleScanRetranslations}
              className="px-4 py-2 bg-neutral-100 hover:bg-orange-50 text-neutral-800 hover:text-orange-700 rounded-xl text-xs font-bold border border-neutral-300 hover:border-orange-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Languages className="w-3.5 h-3.5 text-orange-600" />
              <span>
                {isScanningTranslations
                  ? lang === 'th'
                    ? 'กำลังสแกน...'
                    : 'Scanning...'
                  : lang === 'th'
                  ? 'ตรวจสอบและดูตัวอย่าง'
                  : 'Scan & Preview'}
              </span>
            </button>
          </div>
        </div>

        {retranslateFeedback && (
          <div className="p-3 rounded-2xl text-xs font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{retranslateFeedback}</span>
          </div>
        )}
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
            <h3 className="font-extrabold text-sm text-neutral-900">
              {t.settings.formulaGuideBtn}
            </h3>
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
      <ConfirmModal
        isOpen={isRebuildConfirmOpen}
        title={t.settings.rebuildSummariesTitle}
        message={
          lang === 'th'
            ? 'ต้องการประมวลผลและซิงค์ยอดสรุปรายวันทั้งหมดจากบิลจริงใหม่ใช่หรือไม่?'
            : 'Rebuild and synchronize all daily summaries from real bills?'
        }
        confirmLabel={t.settings.rebuildSummariesBtn}
        cancelLabel={t.common.cancel}
        variant="warning"
        isLoading={isRebuilding}
        onCancel={() => setIsRebuildConfirmOpen(false)}
        onConfirm={handleConfirmRebuildSummaries}
      />

      {isRetranslateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <div className="modal-panel-fixed bg-white rounded-3xl shadow-2xl max-w-3xl w-full border border-orange-200">
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Languages className="w-5 h-5" />
                <h3 className="font-extrabold text-base">
                  {lang === 'th'
                    ? 'ตัวอย่างการแปลชื่อภาษาอังกฤษใหม่'
                    : 'Re-translate Auto-Generated Names Preview'}
                </h3>
              </div>
              <button
                type="button"
                disabled={isApplyingTranslations}
                onClick={() => setIsRetranslateModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 font-bold">
                  {lang === 'th'
                    ? `รายการที่จะอัปเดต: ${retranslateItems.length}`
                    : `Updates ready: ${retranslateItems.length}`}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-700 font-bold">
                  {lang === 'th'
                    ? `ข้ามชื่อที่แก้เอง: ${retranslateStats.skippedManualCount}`
                    : `Manual kept: ${retranslateStats.skippedManualCount}`}
                </span>
                {retranslateStats.unresolvedCount > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {lang === 'th'
                        ? `รอตรวจสอบ EN: ${retranslateStats.unresolvedCount}`
                        : `Needs EN review: ${retranslateStats.unresolvedCount}`}
                    </span>
                  </span>
                )}
              </div>

              {retranslateItems.length === 0 ? (
                <div className="p-8 bg-neutral-50 border border-dashed border-neutral-300 rounded-2xl text-center text-xs text-neutral-600">
                  {lang === 'th'
                    ? 'ชื่อภาษาอังกฤษที่สร้างอัตโนมัติทั้งหมดเป็นเวอร์ชันล่าสุดแล้ว'
                    : 'All auto-generated English names are already up to date.'}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-neutral-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-neutral-100 border-b border-neutral-200 text-[11px] font-extrabold text-neutral-700">
                        <th className="py-2 px-3">{lang === 'th' ? 'ประเภท' : 'Type'}</th>
                        <th className="py-2 px-3">{lang === 'th' ? 'ชื่อไทย' : 'Thai Name'}</th>
                        <th className="py-2 px-3">{lang === 'th' ? 'อังกฤษเดิม' : 'Old EN'}</th>
                        <th className="py-2 px-3">{lang === 'th' ? 'อังกฤษใหม่' : 'New EN'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {retranslateItems.map((item) => (
                        <tr key={item.key} className="hover:bg-orange-50/40">
                          <td className="py-2 px-3 font-bold text-neutral-600 whitespace-nowrap">
                            {getEntityTypeLabel(item.entityType)}
                          </td>
                          <td className="py-2 px-3 font-bold text-neutral-900">{item.thaiName}</td>
                          <td className="py-2 px-3 text-neutral-500">
                            {item.oldEnglish || '—'}
                          </td>
                          <td className="py-2 px-3 font-extrabold text-emerald-700">
                            {item.newEnglish}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={isApplyingTranslations}
                onClick={() => setIsRetranslateModalOpen(false)}
                className="px-4 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={isApplyingTranslations || retranslateItems.length === 0}
                onClick={handleApplyRetranslations}
                className="px-5 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer disabled:opacity-50"
              >
                {isApplyingTranslations
                  ? lang === 'th'
                    ? 'กำลังอัปเดต...'
                    : 'Applying...'
                  : lang === 'th'
                  ? `ยืนยันอัปเดต (${retranslateItems.length})`
                  : `Apply (${retranslateItems.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      <FoodDictionaryModal
        isOpen={isDictionaryModalOpen}
        lang={lang}
        onClose={() => setIsDictionaryModalOpen(false)}
        onRetranslateClick={handleScanRetranslations}
      />
    </div>
  );
};
