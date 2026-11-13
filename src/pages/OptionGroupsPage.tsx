import React, { useState, useEffect } from 'react';
import {
  OptionGroupDoc,
  OptionChoice,
  IngredientDoc,
  SettingsDoc,
  Language,
} from '../types';
import { translations } from '../i18n/translations';
import { formatMoney, calculateOptionChoiceCost } from '../engine/calculations';
import { fetchCollection, saveDocument, deleteDocument } from '../data/db';
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

  const loadData = async () => {
    const [ogs, ings] = await Promise.all([
      fetchCollection<OptionGroupDoc>('optionGroups'),
      fetchCollection<IngredientDoc>('ingredients'),
    ]);
    setOptionGroups(ogs.sort((a, b) => a.order - b.order));
    setIngredients(ings);
  };

  useEffect(() => {
    loadData();
  }, []);

  const ingredientsMap = new Map<string, IngredientDoc>(ingredients.map((i) => [i.id, i]));

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup || !editingGroup.name) return;

    const isNew = !editingGroup.id;
    const groupToSave: OptionGroupDoc = {
      id: editingGroup.id || `og_${Date.now()}`,
      name: editingGroup.name,
      ...(editingGroup.nameTh ? { nameTh: editingGroup.nameTh } : {}),
      minSelect: editingGroup.minSelect || 0,
      maxSelect: editingGroup.maxSelect || 1,
      order: editingGroup.order || optionGroups.length + 1,
      choices: editingGroup.choices || [],
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
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
            <Sliders className="w-6 h-6 text-amber-600" />
            <span>{t.nav.optionGroups}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Create reusable modifier libraries (spiciness, toppings, sides) and link them to dishes.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingGroup({
              name: '',
              minSelect: 0,
              maxSelect: 1,
              choices: [
                { id: `c_${Date.now()}_1`, name: 'Choice 1', price: 0 },
                { id: `c_${Date.now()}_2`, name: 'Choice 2', price: 10 },
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
                  setEditingGroup(group);
                  setIsEditorOpen(true);
                }}
                className="p-1.5 text-neutral-600 hover:text-orange-600 rounded-lg hover:bg-neutral-100 cursor-pointer"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={async () => {
                  if (confirm(`Delete group ${group.name}?`)) {
                    await deleteDocument('optionGroups', group.id);
                    loadData();
                  }
                }}
                className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
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
            className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-orange-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                {editingGroup.id ? 'Edit Option Group' : t.menuCost.addOptionGroup}
              </h3>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1 rounded-xl bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Group Name (EN)
                  </label>
                  <input
                    type="text"
                    required
                    value={editingGroup.name || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                    placeholder="e.g. Spice Level"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Group Name (TH)
                  </label>
                  <input
                    type="text"
                    value={editingGroup.nameTh || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, nameTh: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                    placeholder="e.g. ระดับความเผ็ด"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.minSelect}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={editingGroup.minSelect || 0}
                    onChange={(e) => setEditingGroup({ ...editingGroup, minSelect: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    {t.menuCost.maxSelect}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={editingGroup.maxSelect || 1}
                    onChange={(e) => setEditingGroup({ ...editingGroup, maxSelect: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3 py-1.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Choices with Reorder Buttons (▲ ▼) */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-neutral-800">{t.menuCost.optionsList}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newChoice: OptionChoice = {
                        id: `c_${Date.now()}`,
                        name: 'New Option',
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

                <div className="space-y-1.5">
                  {editingGroup.choices?.map((choice, idx) => (
                    <div
                      key={choice.id}
                      className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center gap-2 text-xs"
                    >
                      {/* Reorder Buttons */}
                      <div className="flex flex-col gap-0.5">
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

                      <input
                        type="text"
                        value={choice.name}
                        onChange={(e) => {
                          const updated = [...(editingGroup.choices || [])];
                          updated[idx].name = e.target.value;
                          setEditingGroup({ ...editingGroup, choices: updated });
                        }}
                        className="flex-1 px-2 py-1 bg-white border border-neutral-300 rounded-lg text-xs"
                        placeholder="Option name"
                      />

                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-bold text-neutral-500">+฿</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={choice.price}
                          onChange={(e) => {
                            const updated = [...(editingGroup.choices || [])];
                            updated[idx].price = parseFloat(e.target.value) || 0;
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
                        className="text-neutral-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
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
    </div>
  );
};
