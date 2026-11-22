import React, { useState, useEffect, useRef } from 'react';
import {
  OptionGroupDoc,
  OptionChoice,
  IngredientDoc,
  SettingsDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import { formatMoney, calculateOptionChoiceCost } from '../engine/calculations';
import { subscribeCollection, saveDocument, deleteDocument } from '../data/db';
import { translateThaiToEnglish, computeAutoEnglishName } from '../utils/thaiToEnglish';
import {
  useDebouncedTranslationScheduler,
  needsEnglishReview,
} from '../hooks/useDebouncedThaiTranslation';
import { NumericInput } from '../costing/components/common/NumericInput';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  Sliders,
  Plus,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  X,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
}

export const OptionGroupsPage: React.FC<Props> = ({ settings, lang }) => {
  const t = translations[lang];
  const [optionGroups, setOptionGroups] = useState<OptionGroupDoc[]>([]);
  const [ingredients, setIngredients] = useState<IngredientDoc[]>([]);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Partial<OptionGroupDoc> | null>(null);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<OptionGroupDoc | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const manualEnKeysRef = useRef<Set<string>>(new Set());
  const prevGroupThaiRef = useRef<string>('');
  const prevChoiceThaiRef = useRef<Map<string, string>>(new Map());
  const translationScheduler = useDebouncedTranslationScheduler(600);

  const loadData = async () => {
    // Handled continuously in real time by Firestore onSnapshot subscriptions below
  };

  useEffect(() => {
    const unsubGroups = subscribeCollection<OptionGroupDoc>('optionGroups', (ogs) => {
      setOptionGroups([...ogs].sort((a, b) => (a.order || 0) - (b.order || 0)));
    });
    const unsubIngs = subscribeCollection<IngredientDoc>('ingredients', (ings) => {
      setIngredients(ings);
    });
    return () => {
      unsubGroups();
      unsubIngs();
    };
  }, []);

  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup) return;
    translationScheduler.cancelAll();

    const finalNameTh = (editingGroup.nameTh || '').trim();
    const isGroupManual = manualEnKeysRef.current.has('group');
    const resolvedGroupEn = isGroupManual
      ? (editingGroup.name || '').trim()
      : computeAutoEnglishName({
          previousThai: prevGroupThaiRef.current || finalNameTh,
          nextThai: finalNameTh,
          currentEnglish: editingGroup.name || '',
          isManuallyEdited: false,
        }).trim() || (finalNameTh ? translateThaiToEnglish(finalNameTh) : '');

    if (!resolvedGroupEn && !finalNameTh) return;

    const normalizedChoices: OptionChoice[] = (editingGroup.choices || [])
      .map((c) => {
        const cTh = (c.nameTh || '').trim();
        const isChoiceManual = manualEnKeysRef.current.has(`choice_${c.id}`);
        const cEn = isChoiceManual
          ? (c.name || '').trim()
          : computeAutoEnglishName({
              previousThai: prevChoiceThaiRef.current.get(c.id) ?? cTh,
              nextThai: cTh,
              currentEnglish: c.name || '',
              isManuallyEdited: false,
            }).trim() || (cTh ? translateThaiToEnglish(cTh) : '');
        if (!cTh && !cEn) return null;
        return {
          id: c.id,
          name: cEn || cTh,
          ...(cTh ? { nameTh: cTh } : {}),
          nameEnManual: isChoiceManual,
          price: Number(c.price) || 0,
          ...(c.ingredients ? { ingredients: c.ingredients } : {}),
        } as OptionChoice;
      })
      .filter((c): c is OptionChoice => c !== null);

    const isNew = !editingGroup.id;
    const groupToSave: OptionGroupDoc = {
      id: editingGroup.id || `og_${Date.now()}`,
      name: resolvedGroupEn || finalNameTh,
      ...(finalNameTh ? { nameTh: finalNameTh } : {}),
      nameEnManual: isGroupManual,
      minSelect: editingGroup.minSelect || 0,
      maxSelect: editingGroup.maxSelect || 1,
      order: editingGroup.order || optionGroups.length + 1,
      choices: normalizedChoices,
      createdAt: editingGroup.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: editingGroup.version || 1,
    };

    await saveDocument('optionGroups', groupToSave, isNew);
    setIsEditorOpen(false);
    setEditingGroup(null);
    loadData();
  };

  // Move choice up or down
  const moveChoice = (index: number, direction: 'up' | 'down') => {
    if (!editingGroup || !editingGroup.choices) return;
    const choices = [...editingGroup.choices];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= choices.length) return;

    const temp = choices[index];
    choices[index] = choices[targetIdx];
    choices[targetIdx] = temp;
    setEditingGroup({ ...editingGroup, choices });
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 select-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
          <Sliders className="w-6 h-6 text-amber-600" />
          <span>{t.nav.optionGroups}</span>
        </h2>

        <button
          onClick={() => {
            translationScheduler.cancelAll();
            manualEnKeysRef.current.clear();
            prevGroupThaiRef.current = '';
            prevChoiceThaiRef.current.clear();
            setEditingGroup({
              name: '',
              nameTh: '',
              minSelect: 0,
              maxSelect: 0,
              choices: [
                { id: `c_${Date.now()}_1`, nameTh: '', name: '', price: 0 },
                { id: `c_${Date.now()}_2`, nameTh: '', name: '', price: 0 },
              ],
            });
            setIsEditorOpen(true);
          }}
          className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer hover:brightness-105"
        >
          <Plus className="w-4 h-4" />
          <span>{t.menuCost.addOptionGroup}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {optionGroups.map((group) => (
          <div
            key={group.id}
            className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-black text-base text-neutral-900">
                    {lang === 'th' && group.nameTh ? group.nameTh : group.name}
                  </h4>
                  <span className="text-[10px] font-bold text-neutral-400">
                    Min {group.minSelect} • Max {group.maxSelect}
                  </span>
                </div>
              </div>

              {/* Choices list */}
              <div className="mt-3 space-y-1.5">
                {group.choices.map((c) => {
                  const choiceCostCalc = calculateOptionChoiceCost(c, ingredientsMap);
                  return (
                    <div
                      key={c.id}
                      className="flex justify-between items-center p-2 bg-neutral-50 rounded-xl text-xs border border-neutral-100 font-semibold"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{lang === 'th' && c.nameTh ? c.nameTh : c.name}</span>
                        {choiceCostCalc.hasMissing && (
                          <span className="text-[9px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            <span>{t.menuCost.missingCost}</span>
                          </span>
                        )}
                        {choiceCostCalc.cost > 0 && (
                          <span className="text-[10px] text-neutral-500 font-normal">
                            (Cost ฿{formatMoney(choiceCostCalc.cost)})
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-orange-600">
                        {c.price > 0 ? `+฿${formatMoney(c.price)}` : 'Free'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-1.5 mt-4 pt-2 border-t border-neutral-100">
              <button
                onClick={() => {
                  translationScheduler.cancelAll();
                  manualEnKeysRef.current.clear();
                  if (group.nameEnManual) {
                    manualEnKeysRef.current.add('group');
                  }
                  prevGroupThaiRef.current = group.nameTh || '';
                  prevChoiceThaiRef.current.clear();
                  (group.choices || []).forEach((c) => {
                    prevChoiceThaiRef.current.set(c.id, c.nameTh || '');
                    if (c.nameEnManual) {
                      manualEnKeysRef.current.add(`choice_${c.id}`);
                    }
                  });
                  setEditingGroup({
                    ...group,
                    choices: (group.choices || []).map((c) => ({ ...c })),
                  });
                  setIsEditorOpen(true);
                }}
                className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPendingDeleteGroup(group)}
                className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                title={t.common.delete}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Group Editor Modal */}
      {isEditorOpen && editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveGroup}
            className="modal-panel-fixed bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-orange-200"
          >
            <div className="modal-header bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {editingGroup.id
                  ? lang === 'th'
                    ? 'แก้ไขกลุ่มตัวเลือก'
                    : 'Edit Option Group'
                  : t.menuCost.addOptionGroup}
              </h3>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {lang === 'th' ? 'ชื่อกลุ่ม (ภาษาไทย) *' : 'Group Name (Thai) *'}
                  </label>
                  <input
                    type="text"
                    required={!editingGroup.name}
                    value={editingGroup.nameTh || ''}
                    onChange={(e) => {
                      const nextTh = e.target.value;
                      setEditingGroup((prev) => (prev ? { ...prev, nameTh: nextTh } : prev));
                      translationScheduler.schedule('group', () => {
                        setEditingGroup((prev) => {
                          if (!prev) return prev;
                          const currTh = prev.nameTh || '';
                          const nextEn = computeAutoEnglishName({
                            previousThai: prevGroupThaiRef.current,
                            nextThai: currTh,
                            currentEnglish: prev.name || '',
                            isManuallyEdited: manualEnKeysRef.current.has('group'),
                          });
                          prevGroupThaiRef.current = currTh;
                          return { ...prev, name: nextEn };
                        });
                      });
                    }}
                    onBlur={() => translationScheduler.flush('group')}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                    placeholder={lang === 'th' ? 'เช่น ระดับความเผ็ด, ท็อปปิ้ง' : 'e.g. ระดับความเผ็ด, ท็อปปิ้ง'}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <label className="block text-xs font-bold text-neutral-700">
                        {lang === 'th' ? 'ชื่อกลุ่ม (อังกฤษ)' : 'Group Name (EN)'}
                      </label>
                      {needsEnglishReview(editingGroup.nameTh, editingGroup.name) && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}</span>
                        </span>
                      )}
                    </div>
                    {editingGroup.nameTh && (
                      <button
                        type="button"
                        onClick={() => {
                          translationScheduler.cancel('group');
                          manualEnKeysRef.current.delete('group');
                          prevGroupThaiRef.current = editingGroup.nameTh || '';
                          setEditingGroup({
                            ...editingGroup,
                            name: translateThaiToEnglish(editingGroup.nameTh || ''),
                            nameEnManual: false,
                          });
                        }}
                        className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer"
                      >
                        {lang === 'th' ? 'แปลใหม่' : 'Re-translate'}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={editingGroup.name || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      translationScheduler.cancel('group');
                      if (val.trim()) {
                        manualEnKeysRef.current.add('group');
                      } else {
                        manualEnKeysRef.current.delete('group');
                      }
                      setEditingGroup({
                        ...editingGroup,
                        name: val,
                        nameEnManual: Boolean(val.trim()),
                      });
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                    placeholder="e.g. Spice Level"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.minSelect}
                  </label>
                  <NumericInput
                    min={0}
                    max={10}
                    value={editingGroup.minSelect}
                    onValueChange={(val) => setEditingGroup({ ...editingGroup, minSelect: Math.round(val) })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.maxSelect}
                  </label>
                  <NumericInput
                    min={1}
                    max={20}
                    value={editingGroup.maxSelect}
                    onValueChange={(val) => setEditingGroup({ ...editingGroup, maxSelect: Math.round(val) })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Choices with Reorder Buttons (▲ ▼) & Thai-first + Auto-EN */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-neutral-800">{t.menuCost.optionsList}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newChoice: OptionChoice = {
                        id: `c_${Date.now()}`,
                        nameTh: '',
                        name: '',
                        price: 0,
                      };
                      setEditingGroup({
                        ...editingGroup,
                        choices: [...(editingGroup.choices || []), newChoice],
                      });
                    }}
                    className="text-xs text-orange-600 hover:text-orange-700 font-bold cursor-pointer"
                  >
                    {t.menuCost.addChoice}
                  </button>
                </div>

                <div className="space-y-2">
                  {editingGroup.choices?.map((choice, idx) => (
                    <div
                      key={choice.id}
                      className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center gap-2 text-xs"
                    >
                      {/* Reorder Buttons */}
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveChoice(idx, 'up')}
                          className="p-0.5 text-neutral-500 hover:text-neutral-900 disabled:opacity-20 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === (editingGroup.choices?.length || 0) - 1}
                          onClick={() => moveChoice(idx, 'down')}
                          className="p-0.5 text-neutral-500 hover:text-neutral-900 disabled:opacity-20 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        <input
                          type="text"
                          required={!choice.name}
                          value={choice.nameTh || ''}
                          onChange={(e) => {
                            const nextTh = e.target.value;
                            const choiceKey = `choice_${choice.id}`;
                            setEditingGroup((prev) => {
                              if (!prev) return prev;
                              const updated = [...(prev.choices || [])];
                              if (!updated[idx]) return prev;
                              updated[idx] = { ...updated[idx], nameTh: nextTh };
                              return { ...prev, choices: updated };
                            });
                            translationScheduler.schedule(choiceKey, () => {
                              setEditingGroup((prev) => {
                                if (!prev) return prev;
                                const updated = [...(prev.choices || [])];
                                const target = updated[idx];
                                if (!target) return prev;
                                const currTh = target.nameTh || '';
                                const prevTh = prevChoiceThaiRef.current.get(choice.id) ?? '';
                                const nextEn = computeAutoEnglishName({
                                  previousThai: prevTh,
                                  nextThai: currTh,
                                  currentEnglish: target.name || '',
                                  isManuallyEdited: manualEnKeysRef.current.has(choiceKey),
                                });
                                prevChoiceThaiRef.current.set(choice.id, currTh);
                                updated[idx] = { ...target, name: nextEn };
                                return { ...prev, choices: updated };
                              });
                            });
                          }}
                          onBlur={() => translationScheduler.flush(`choice_${choice.id}`)}
                          className="w-full px-2 py-1 bg-white border border-orange-300 rounded-lg text-xs"
                          placeholder={lang === 'th' ? 'ชื่อไทย (เช่น เผ็ดน้อย)' : 'Thai name (e.g. เผ็ดน้อย)'}
                        />
                        <div className="relative flex items-center">
                          <input
                            type="text"
                            value={choice.name || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              const key = `choice_${choice.id}`;
                              translationScheduler.cancel(key);
                              if (val.trim()) {
                                manualEnKeysRef.current.add(key);
                              } else {
                                manualEnKeysRef.current.delete(key);
                              }
                              const updated = [...(editingGroup.choices || [])];
                              updated[idx] = {
                                ...updated[idx],
                                name: val,
                                nameEnManual: Boolean(val.trim()),
                              };
                              setEditingGroup({ ...editingGroup, choices: updated });
                            }}
                            className={`w-full px-2 py-1 bg-neutral-100/70 border border-neutral-300 rounded-lg text-xs ${
                              needsEnglishReview(choice.nameTh, choice.name) ? 'pr-6' : ''
                            }`}
                            placeholder={lang === 'th' ? 'ภาษาอังกฤษ (แปลอัตโนมัติ)' : 'English (auto)'}
                          />
                          {needsEnglishReview(choice.nameTh, choice.name) && (
                            <span
                              title={lang === 'th' ? 'รอตรวจสอบ EN' : 'Needs EN'}
                              className="absolute right-1.5 text-amber-600 pointer-events-none"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[11px] font-bold text-neutral-500">+฿</span>
                        <NumericInput
                          min={0}
                          step={1}
                          value={choice.price}
                          onValueChange={(val) => {
                            const updated = [...(editingGroup.choices || [])];
                            updated[idx] = { ...updated[idx], price: val };
                            setEditingGroup({ ...editingGroup, choices: updated });
                          }}
                          className="w-16 px-1.5 py-1 text-right bg-white border border-neutral-300 rounded-lg text-xs font-bold"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...(editingGroup.choices || [])];
                          updated.splice(idx, 1);
                          setEditingGroup({ ...editingGroup, choices: updated });
                        }}
                        className="text-neutral-400 hover:text-rose-600 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-3 py-1.5 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteGroup)}
        title={lang === 'th' ? 'ยืนยันการลบกลุ่มตัวเลือก' : 'Delete Option Group'}
        message={
          lang === 'th'
            ? `ต้องการลบกลุ่ม "${pendingDeleteGroup?.nameTh || pendingDeleteGroup?.name || ''}" ใช่หรือไม่?`
            : `Delete group "${pendingDeleteGroup?.name || ''}"?`
        }
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setPendingDeleteGroup(null);
        }}
        onConfirm={async () => {
          if (!pendingDeleteGroup) return;
          setIsDeleting(true);
          try {
            await deleteDocument('optionGroups', pendingDeleteGroup.id);
            setPendingDeleteGroup(null);
            loadData();
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </div>
  );
};
