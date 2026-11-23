import React, { useState, useEffect, useMemo } from 'react';
import { Language } from '../types';
import {
  getShopTranslationGlossary,
  subscribeShopTranslationGlossary,
  upsertShopTranslationEntry,
  removeShopTranslationEntry,
  getBuiltInFoodDictionary,
  containsThaiCharacters,
  normalizeThaiForTranslation,
} from '../utils/thaiToEnglish';
import {
  BookOpen,
  Search,
  Plus,
  Edit2,
  Trash2,
  X,
  Sparkles,
  Check,
  AlertTriangle,
} from 'lucide-react';

interface FoodDictionaryModalProps {
  isOpen: boolean;
  lang: Language;
  onClose: () => void;
  onRetranslateClick?: () => void;
}

export const FoodDictionaryModal: React.FC<FoodDictionaryModalProps> = ({
  isOpen,
  lang,
  onClose,
  onRetranslateClick,
}) => {
  const [activeTab, setActiveTab] = useState<'custom' | 'builtin'>('custom');
  const [searchQuery, setSearchQuery] = useState('');
  const [customEntries, setCustomEntries] = useState<Record<string, string>>(() =>
    getShopTranslationGlossary()
  );

  // Add / edit form states
  const [thaiInput, setThaiInput] = useState('');
  const [englishInput, setEnglishInput] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSavedNotice, setFormSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCustomEntries(getShopTranslationGlossary());
    const unsubscribe = subscribeShopTranslationGlossary((next) => {
      setCustomEntries(next);
    });
    return unsubscribe;
  }, [isOpen]);

  const builtInEntries = useMemo(() => getBuiltInFoodDictionary(), []);

  const builtInThaiMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of builtInEntries) {
      map.set(item.thai, item.english);
    }
    return map;
  }, [builtInEntries]);

  const customList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return Object.entries(customEntries)
      .filter(([th, en]) => {
        if (!q) return true;
        return th.toLowerCase().includes(q) || en.toLowerCase().includes(q);
      })
      .sort((a, b) => a[0].localeCompare(b[0], 'th'));
  }, [customEntries, searchQuery]);

  const filteredBuiltIn = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = builtInEntries.filter((item) => {
      if (!q) return true;
      return item.thai.toLowerCase().includes(q) || item.english.toLowerCase().includes(q);
    });
    // Cap initial unfiltered render only if empty search? No, 700 items is fast in React, or show first 250 with count hint if huge.
    return list;
  }, [builtInEntries, searchQuery]);

  if (!isOpen) return null;

  const totalCustom = Object.keys(customEntries).length;

  const handleResetForm = () => {
    setThaiInput('');
    setEnglishInput('');
    setEditingKey(null);
    setFormError(null);
  };

  const handleSubmitTerm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSavedNotice(null);

    const normTh = normalizeThaiForTranslation(thaiInput.trim());
    const cleanEn = englishInput.trim();

    if (!normTh || !containsThaiCharacters(normTh)) {
      setFormError(
        lang === 'th'
          ? 'กรุณาระบุคำศัพท์ภาษาไทย (ต้องมีตัวอักษรไทย)'
          : 'Please enter a valid Thai food term.'
      );
      return;
    }

    if (!cleanEn) {
      setFormError(
        lang === 'th' ? 'กรุณาระบุคำแปลภาษาอังกฤษ' : 'Please enter the English translation.'
      );
      return;
    }

    if (containsThaiCharacters(cleanEn)) {
      setFormError(
        lang === 'th'
          ? 'ช่องคำแปลภาษาอังกฤษต้องไม่มีตัวอักษรไทย'
          : 'English translation must not contain Thai characters.'
      );
      return;
    }

    if (editingKey && editingKey !== normTh) {
      removeShopTranslationEntry(editingKey);
    }

    upsertShopTranslationEntry(normTh, cleanEn);
    setFormSavedNotice(
      lang === 'th'
        ? `บันทึก "${normTh}" → "${cleanEn}" ลงพจนานุกรมแล้ว`
        : `Saved "${normTh}" → "${cleanEn}" to shop dictionary`
    );
    handleResetForm();
    setActiveTab('custom');
  };

  const handleStartEdit = (thaiTerm: string, englishTerm: string) => {
    setThaiInput(thaiTerm);
    setEnglishInput(englishTerm);
    setEditingKey(thaiTerm);
    setFormError(null);
    setFormSavedNotice(null);
  };

  const handleDeleteTerm = (thaiTerm: string) => {
    if (editingKey === thaiTerm) {
      handleResetForm();
    }
    removeShopTranslationEntry(thaiTerm);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="modal-panel-fixed bg-white rounded-3xl shadow-2xl max-w-3xl w-full border border-orange-200">
        {/* Pinned Header */}
        <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <BookOpen className="w-5 h-5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-extrabold text-base truncate">
                {lang === 'th' ? 'พจนานุกรมอาหาร (Food Dictionary)' : 'Culinary Food Dictionary'}
              </h3>
              <p className="text-[11px] text-orange-100 truncate">
                {lang === 'th'
                  ? `พจนานุกรมในแอป ${builtInEntries.length.toLocaleString()} คำ • คำศัพท์ที่ร้านบันทึกไว้ ${totalCustom} คำ`
                  : `${builtInEntries.length.toLocaleString()} built-in culinary terms • ${totalCustom} saved shop terms`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="modal-body space-y-4">
          {/* Info Banner */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                {lang === 'th'
                  ? 'เรียนรู้และบันทึกคำศัพท์ใหม่อัตโนมัติ'
                  : 'Automatic Shop Dictionary Learning'}
              </div>
              <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                {lang === 'th'
                  ? 'เมื่อคุณเพิ่มหรือบันทึกเมนู ตัวเลือก วัตถุดิบ หรือซอสที่มีคำใหม่หรือแก้ไขคำแปลเอง ระบบจะบันทึกคู่คำศัพท์ไว้ในพจนานุกรมของร้านบนคลาวด์ทันที เพื่อนำไปช่วยแปลเมนูและคำผสมอื่น ๆ ในภายหน้า'
                  : 'Whenever you save a menu item, variant, option, category, ingredient, or sauce with new terms or custom English names, the app automatically saves them here and syncs them across devices for future translations.'}
              </p>
            </div>
          </div>

          {/* Add / Edit Term Form */}
          <form
            onSubmit={handleSubmitTerm}
            className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-extrabold text-neutral-800 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-orange-600" />
                <span>
                  {editingKey
                    ? lang === 'th'
                      ? 'แก้ไขคำศัพท์ในพจนานุกรม'
                      : 'Edit Saved Dictionary Term'
                    : lang === 'th'
                    ? 'เพิ่มคำศัพท์อาหารใหม่เข้าพจนานุกรม'
                    : 'Add New Term to Dictionary'}
                </span>
              </div>
              {editingKey && (
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="text-[11px] font-bold text-neutral-500 hover:text-neutral-800 cursor-pointer"
                >
                  {lang === 'th' ? 'ยกเลิกการแก้ไข' : 'Cancel Edit'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-5">
                <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                  {lang === 'th' ? 'คำศัพท์ภาษาไทย *' : 'Thai Term *'}
                </label>
                <input
                  type="text"
                  value={thaiInput}
                  onChange={(e) => setThaiInput(e.target.value)}
                  placeholder={lang === 'th' ? 'เช่น ชาอู่หลงน้ำผึ้ง' : 'e.g. ชาอู่หลงน้ำผึ้ง'}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                  {lang === 'th' ? 'คำแปลภาษาอังกฤษ *' : 'English Translation *'}
                </label>
                <input
                  type="text"
                  value={englishInput}
                  onChange={(e) => setEnglishInput(e.target.value)}
                  placeholder="e.g. Honey Oolong Tea"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-extrabold shadow-xs hover:brightness-105 cursor-pointer flex items-center justify-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {editingKey
                      ? lang === 'th'
                        ? 'อัปเดต'
                        : 'Update'
                      : lang === 'th'
                      ? 'บันทึก'
                      : 'Save'}
                  </span>
                </button>
              </div>
            </div>

            {formError && (
              <div className="p-2 rounded-xl bg-red-50 border border-red-200 text-[11px] font-bold text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            {formSavedNotice && (
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>{formSavedNotice}</span>
              </div>
            )}
          </form>

          {/* Tabs + Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5 bg-neutral-100 p-1 rounded-2xl border border-neutral-200">
              <button
                type="button"
                onClick={() => setActiveTab('custom')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer transition-colors ${
                  activeTab === 'custom'
                    ? 'bg-white text-orange-700 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {lang === 'th'
                  ? `คำศัพท์ที่บันทึกไว้ (${totalCustom})`
                  : `Saved Shop Terms (${totalCustom})`}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('builtin')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer transition-colors ${
                  activeTab === 'builtin'
                    ? 'bg-white text-orange-700 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {lang === 'th'
                  ? `พจนานุกรมในแอป (${builtInEntries.length})`
                  : `Built-in Dictionary (${builtInEntries.length})`}
              </button>
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  lang === 'th' ? 'ค้นหาคำศัพท์ ไทย / EN...' : 'Search Thai / English...'
                }
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-neutral-300 rounded-xl focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* List Area */}
          {activeTab === 'custom' ? (
            customList.length === 0 ? (
              <div className="p-8 bg-neutral-50 border border-dashed border-neutral-300 rounded-2xl text-center text-xs text-neutral-500">
                {searchQuery.trim()
                  ? lang === 'th'
                    ? 'ไม่พบคำศัพท์ที่ตรงกับคำค้นหา'
                    : 'No saved terms match your search.'
                  : lang === 'th'
                  ? 'ยังไม่มีคำศัพท์ที่เพิ่มเอง — คุณสามารถเพิ่มด้านบน หรือเมื่อบันทึกเมนูที่มีคำศัพท์ใหม่ ระบบจะเพิ่มให้อัตโนมัติ'
                  : 'No saved custom terms yet. Add one above or save any menu/ingredient with custom English text to learn it automatically.'}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-neutral-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-neutral-100 border-b border-neutral-200 text-[11px] font-extrabold text-neutral-700">
                      <th className="py-2 px-3">{lang === 'th' ? 'ภาษาไทย' : 'Thai Term'}</th>
                      <th className="py-2 px-3">{lang === 'th' ? 'ภาษาอังกฤษ' : 'English'}</th>
                      <th className="py-2 px-3 text-right">
                        {lang === 'th' ? 'จัดการ' : 'Actions'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {customList.map(([th, en]) => {
                      const builtInDefault = builtInThaiMap.get(th);
                      return (
                        <tr key={th} className="hover:bg-orange-50/40">
                          <td className="py-2 px-3 font-bold text-neutral-900">
                            <div>{th}</div>
                            {builtInDefault && (
                              <div className="text-[10px] font-normal text-neutral-500">
                                {lang === 'th'
                                  ? `ค่าเริ่มต้นในแอป: ${builtInDefault}`
                                  : `Built-in default: ${builtInDefault}`}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 font-bold text-emerald-700">{en}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(th, en)}
                                className="p-1.5 rounded-lg text-neutral-600 hover:text-orange-700 hover:bg-orange-50 cursor-pointer"
                                title={lang === 'th' ? 'แก้ไข' : 'Edit'}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTerm(th)}
                                className="p-1.5 rounded-lg text-neutral-500 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                title={lang === 'th' ? 'ลบ' : 'Delete'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : filteredBuiltIn.length === 0 ? (
            <div className="p-8 bg-neutral-50 border border-dashed border-neutral-300 rounded-2xl text-center text-xs text-neutral-500">
              {lang === 'th'
                ? 'ไม่พบคำศัพท์ในพจนานุกรมที่ตรงกับคำค้นหา'
                : 'No built-in terms match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 max-h-80 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-neutral-100 border-b border-neutral-200 text-[11px] font-extrabold text-neutral-700">
                    <th className="py-2 px-3">{lang === 'th' ? 'ภาษาไทย' : 'Thai'}</th>
                    <th className="py-2 px-3">{lang === 'th' ? 'ภาษาอังกฤษ' : 'English'}</th>
                    <th className="py-2 px-3">{lang === 'th' ? 'ประเภท' : 'Type'}</th>
                    <th className="py-2 px-3 text-right">
                      {lang === 'th' ? 'ปรับคำแปล' : 'Customize'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredBuiltIn.map((item) => {
                    const customOverride = customEntries[item.thai];
                    return (
                      <tr key={item.thai} className="hover:bg-orange-50/40">
                        <td className="py-1.5 px-3 font-bold text-neutral-900">{item.thai}</td>
                        <td className="py-1.5 px-3 text-neutral-700">
                          {customOverride ? (
                            <div>
                              <span className="font-bold text-emerald-700">{customOverride}</span>
                              <span className="block text-[10px] text-neutral-400 line-through">
                                {item.english}
                              </span>
                            </div>
                          ) : (
                            item.english
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-[11px] text-neutral-500 whitespace-nowrap">
                          {item.kind === 'phrase'
                            ? lang === 'th'
                              ? 'ชื่อเมนู/วลี'
                              : 'Dish / Phrase'
                            : lang === 'th'
                            ? 'คำศัพท์'
                            : 'Term'}
                        </td>
                        <td className="py-1.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleStartEdit(item.thai, customOverride || item.english)
                            }
                            className="px-2 py-1 rounded-lg text-[11px] font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 cursor-pointer"
                          >
                            {lang === 'th' ? 'กำหนดเอง' : 'Override'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pinned Footer */}
        <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-2">
          <div>
            {onRetranslateClick && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRetranslateClick();
                }}
                className="px-3.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-300 rounded-xl text-xs font-extrabold cursor-pointer"
              >
                {lang === 'th'
                  ? 'สแกนแปลเมนูด้วยพจนานุกรมล่าสุด'
                  : 'Re-translate Menus Now'}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
          >
            {lang === 'th' ? 'ปิด' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
