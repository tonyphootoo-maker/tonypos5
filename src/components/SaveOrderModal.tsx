import React, { useState } from 'react';
import { TableDoc, ZoneDoc, Language } from '../types';
import { translations } from '../i18n/translations';
import { X, CheckCircle, Users } from 'lucide-react';

interface Props {
  tables: TableDoc[];
  zones: ZoneDoc[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  lang: Language;
}

export const SaveOrderModal: React.FC<Props> = ({
  tables,
  zones,
  selectedTableId,
  onSelectTable,
  onConfirm,
  onClose,
  lang,
}) => {
  const [activeZoneId, setActiveZoneId] = useState<string>('all');
  const t = translations[lang];

  // Filter tables according to zone
  const visibleTables =
    activeZoneId === 'all'
      ? tables
      : tables.filter((tbl) => tbl.zoneId === activeZoneId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-orange-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between shadow-xs">
          <div>
            <h3 className="font-extrabold text-base">{t.pos.saveOrderToTable}</h3>
            <p className="text-xs text-orange-100">{t.pos.selectTargetTable}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Zone Chip Bar at top (All zones + each zone) */}
        <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveZoneId('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all shadow-2xs ${
              activeZoneId === 'all'
                ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-xs'
                : 'bg-white text-neutral-700 hover:bg-neutral-50 border border-neutral-300'
            }`}
          >
            {t.pos.allZones}
          </button>
          {zones.map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => setActiveZoneId(z.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all shadow-2xs ${
                activeZoneId === z.id
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-xs'
                  : 'bg-white text-neutral-700 hover:bg-neutral-50 border border-neutral-300'
              }`}
            >
              {lang === 'th' && z.nameTh ? z.nameTh : z.name}
            </button>
          ))}
        </div>

        {/* Tables Content View */}
        <div className="flex-1 overflow-y-auto p-4 bg-neutral-50/50">
          {activeZoneId === 'all' ? (
            // Cards view
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {visibleTables.map((tbl) => {
                const isOccupied = !!tbl.currentBillId;
                const isSelected = selectedTableId === tbl.id;

                return (
                  <div
                    key={tbl.id}
                    onClick={() => onSelectTable(tbl.id)}
                    className={`p-3.5 rounded-2xl cursor-pointer transition-all duration-150 flex flex-col justify-between h-28 relative select-none ${
                      isSelected
                        ? 'ring-4 ring-orange-500 bg-orange-50 shadow-md'
                        : isOccupied
                        ? 'border-2 border-red-600 bg-red-50/40 hover:bg-red-50'
                        : 'border-2 border-emerald-800 bg-white hover:bg-emerald-50/30 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-lg text-neutral-900">{tbl.name}</span>
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                          isOccupied
                            ? 'bg-red-600 text-white'
                            : 'bg-emerald-800 text-white'
                        }`}
                      >
                        {isOccupied ? t.pos.occupiedTable : t.pos.freeTable}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-neutral-500 font-semibold">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        <span>{tbl.chairs} {t.pos.chairs}</span>
                      </span>
                      {isSelected && <CheckCircle className="w-5 h-5 text-orange-600" />}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Specific Zone Floor Plan
            <div className="relative w-full h-[360px] bg-white rounded-2xl border border-neutral-300 shadow-inner overflow-hidden p-2">
              <div className="text-[11px] font-bold text-neutral-400 absolute top-2 left-3 select-none">
                Floor Plan View
              </div>
              {visibleTables.map((tbl) => {
                const isOccupied = !!tbl.currentBillId;
                const isSelected = selectedTableId === tbl.id;

                const shapeClass =
                  tbl.shape === 'round'
                    ? 'rounded-full'
                    : tbl.shape === 'rectangle'
                    ? 'rounded-xl w-24 h-16'
                    : 'rounded-xl w-20 h-20';

                return (
                  <div
                    key={tbl.id}
                    onClick={() => onSelectTable(tbl.id)}
                    style={{ left: `${tbl.x}px`, top: `${tbl.y}px` }}
                    className={`absolute cursor-pointer flex flex-col items-center justify-center p-1 select-none transition-all duration-150 ${shapeClass} ${
                      isSelected
                        ? 'ring-4 ring-orange-500 bg-orange-100 shadow-lg scale-105'
                        : isOccupied
                        ? 'border-3 border-red-600 bg-red-50 text-red-950 shadow-sm'
                        : 'border-3 border-emerald-800 bg-white text-emerald-950 shadow-sm'
                    }`}
                  >
                    <span className="font-black text-sm">{tbl.name}</span>
                    <span className="text-[10px] font-semibold text-neutral-500 flex items-center gap-0.5">
                      <Users className="w-3 h-3" />
                      {tbl.chairs}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-bold border border-neutral-300 cursor-pointer"
          >
            {t.common.cancel}
          </button>

          <button
            type="button"
            disabled={!selectedTableId}
            onClick={onConfirm}
            className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:brightness-105"
          >
            {t.pos.saveOrderToTable}
          </button>
        </div>
      </div>
    </div>
  );
};
