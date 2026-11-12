import React, { useState } from 'react';
import { ShiftDoc, Language, SettingsDoc } from '../types';
import { translations } from '../i18n/translations';
import { formatMoney, getBusinessWorkDate, roundTo2 } from '../engine/calculations';
import { saveDocument } from '../data/db';
import { X, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  activeShift: ShiftDoc | null;
  settings: SettingsDoc;
  lang: Language;
  onClose: () => void;
  onShiftUpdated: (shift: ShiftDoc | null) => void;
}

export const ShiftModal: React.FC<Props> = ({
  activeShift,
  settings,
  lang,
  onClose,
  onShiftUpdated,
}) => {
  const t = translations[lang];
  const [startingCash, setStartingCash] = useState<number>(2000);
  const [countedCash, setCountedCash] = useState<number>(activeShift?.startingCash || 0);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const workDate = getBusinessWorkDate(new Date(), settings.dailyClosingTime);

  // Expected cash calculation
  const expectedCash = activeShift ? activeShift.startingCash : 0;
  const discrepancy = roundTo2(countedCash - expectedCash);

  const handleOpenShift = async () => {
    setIsSubmitting(true);
    try {
      const newShift: ShiftDoc = {
        id: `shift_${Date.now()}`,
        openedAt: new Date().toISOString(),
        startingCash: Math.max(0, startingCash),
        status: 'open',
        workDate,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      await saveDocument('shifts', newShift, true);
      onShiftUpdated(newShift);
      onClose();
    } catch (err) {
      console.error('Error opening shift:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;
    setIsSubmitting(true);
    try {
      const closedShift: ShiftDoc = {
        ...activeShift,
        closedAt: new Date().toISOString(),
        countedCash,
        expectedCash,
        discrepancy,
        notes: notes || activeShift.notes,
        status: 'closed',
        updatedAt: new Date().toISOString(),
        version: activeShift.version,
      };

      await saveDocument('shifts', closedShift, false);
      onShiftUpdated(null);
      onClose();
    } catch (err) {
      console.error('Error closing shift:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-orange-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-200" />
            <h3 className="font-extrabold text-base">
              {activeShift ? t.shift.closeShiftTitle : t.shift.openShiftTitle}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {!activeShift ? (
            // Open Shift View
            <div className="space-y-3">
              <label className="block text-xs font-bold text-neutral-800">
                {t.shift.startingCashPrompt}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm font-bold text-neutral-500">฿</span>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={startingCash}
                  onChange={(e) => setStartingCash(parseFloat(e.target.value) || 0)}
                  className="w-full pl-8 pr-4 py-2 font-black text-lg bg-neutral-50 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div className="text-[11px] text-neutral-500">
                Business Work Date: <strong>{workDate}</strong>
              </div>
            </div>
          ) : (
            // Close Shift View
            <div className="space-y-3">
              <div className="p-3 bg-neutral-100 rounded-2xl space-y-1.5 text-xs">
                <div className="flex justify-between text-neutral-600">
                  <span>{t.shift.activeShiftInfo}:</span>
                  <span className="font-bold">
                    {new Date(activeShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex justify-between text-neutral-800">
                  <span>Starting Cash:</span>
                  <span className="font-bold">฿{formatMoney(activeShift.startingCash)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-800 mb-1">
                  {t.shift.countedCashPrompt}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-sm font-bold text-neutral-500">฿</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={countedCash}
                    onChange={(e) => setCountedCash(parseFloat(e.target.value) || 0)}
                    className="w-full pl-8 pr-4 py-2 font-black text-lg bg-neutral-50 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Discrepancy Display */}
              <div
                className={`p-3 rounded-2xl border text-xs flex items-center justify-between ${
                  discrepancy === 0
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : discrepancy > 0
                    ? 'bg-blue-50 border-blue-300 text-blue-900'
                    : 'bg-rose-50 border-rose-300 text-rose-900'
                }`}
              >
                <span className="font-bold">{t.shift.discrepancy}:</span>
                <span className="font-black text-sm">
                  {discrepancy > 0 ? `+฿${formatMoney(discrepancy)} (Over)` : discrepancy < 0 ? `-฿${formatMoney(Math.abs(discrepancy))} (Short)` : '฿0.00 (Balanced)'}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">{t.shift.shiftNotes}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2.5 text-xs bg-neutral-50 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-orange-500"
              placeholder="Notes..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-neutral-100 border-t border-neutral-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-neutral-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={activeShift ? handleCloseShift : handleOpenShift}
            className="px-5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 cursor-pointer hover:brightness-105 disabled:opacity-50"
          >
            {activeShift ? t.shift.confirmClose : t.shift.confirmOpen}
          </button>
        </div>
      </div>
    </div>
  );
};
