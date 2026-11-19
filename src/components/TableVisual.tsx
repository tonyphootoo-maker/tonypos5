import React from 'react';
import { TableDoc, Language } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTableDimensions, normalizeRotation } from '../utils/tablePresets';

interface TableVisualProps {
  table: Pick<
    TableDoc,
    | 'id'
    | 'name'
    | 'shape'
    | 'width'
    | 'height'
    | 'scale'
    | 'rotation'
    | 'tableStyle'
    | 'itemKind'
    | 'chairStyle'
    | 'currentBillId'
  >;
  isSelected?: boolean;
  isDragging?: boolean;
  isOccupied?: boolean;
  compact?: boolean;
  showOccupiedBadge?: boolean;
  scaleFactor?: number;
  lang?: Language;
}

/**
 * Clean Daylight 3D table & standalone chair visual renderer.
 * Tables render purely as tables (no surrounding chairs, no guest count).
 * Chairs render independently when itemKind === 'chair'.
 */
export const TableVisual: React.FC<TableVisualProps> = ({
  table,
  isSelected = false,
  isDragging = false,
  isOccupied = false,
  compact = false,
  showOccupiedBadge = true,
  scaleFactor = 1,
  lang: propLang,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const dim = getTableDimensions(table);
  const minPx = table.itemKind === 'chair' ? 22 : 38;
  const w = Math.max(minPx, Math.round(dim.effWidth * scaleFactor));
  const h = Math.max(minPx, Math.round(dim.effHeight * scaleFactor));

  // Standalone Chair Rendering
  if (table.itemKind === 'chair') {
    const style = table.chairStyle || 'dining';
    const rot = normalizeRotation(table.rotation);

    const baseClasses = isSelected
      ? 'border-2 border-orange-500 bg-orange-100 ring-4 ring-orange-400/50 shadow-[0_4px_0_#fb923c,0_10px_18px_-6px_rgba(234,88,12,0.3)]'
      : style === 'sofa'
      ? 'border-2 border-amber-500 bg-amber-100 shadow-[0_4px_0_#f59e0b,0_8px_16px_-6px_rgba(180,83,9,0.25)]'
      : style === 'armchair'
      ? 'border-2 border-stone-500 bg-stone-200 shadow-[0_4px_0_#78716c,0_8px_16px_-6px_rgba(68,64,60,0.25)]'
      : 'border-2 border-slate-400 bg-slate-100 shadow-[0_4px_0_#94a3b8,0_8px_16px_-6px_rgba(15,23,42,0.18)]';

    const backClasses = isSelected
      ? 'bg-orange-500'
      : style === 'sofa'
      ? 'bg-amber-700'
      : style === 'armchair'
      ? 'bg-stone-600'
      : 'bg-slate-600';

    if (style === 'stool') {
      return (
        <div
          className={`relative select-none flex items-center justify-center transition-shadow rounded-full ${baseClasses} ${
            isDragging ? 'scale-[1.05]' : ''
          }`}
          style={{ width: `${w}px`, height: `${h}px` }}
        >
          <div className="w-[52%] h-[52%] rounded-full border border-slate-400/70 bg-white/60" />
        </div>
      );
    }

    if (style === 'armchair') {
      return (
        <div
          className={`relative select-none transition-shadow rounded-xl overflow-hidden ${baseClasses} ${
            isDragging ? 'scale-[1.05]' : ''
          }`}
          style={{
            width: `${w}px`,
            height: `${h}px`,
            transform: `rotate(${rot}deg)`,
          }}
        >
          <div className={`w-full h-[22%] ${backClasses}`} />
          <div className={`absolute left-0 top-[18%] bottom-[12%] w-[16%] rounded-r-sm ${backClasses} opacity-85`} />
          <div className={`absolute right-0 top-[18%] bottom-[12%] w-[16%] rounded-l-sm ${backClasses} opacity-85`} />
        </div>
      );
    }

    if (style === 'sofa') {
      return (
        <div
          className={`relative select-none transition-shadow rounded-2xl overflow-hidden ${baseClasses} ${
            isDragging ? 'scale-[1.04]' : ''
          }`}
          style={{
            width: `${w}px`,
            height: `${h}px`,
            transform: `rotate(${rot}deg)`,
          }}
        >
          <div className={`w-full h-[26%] ${backClasses}`} />
          <div className="w-full h-[74%] flex items-center justify-evenly px-1.5">
            <div className="h-[68%] flex-1 mx-0.5 rounded-md bg-white/45 border border-amber-400/50" />
            <div className="h-[68%] flex-1 mx-0.5 rounded-md bg-white/45 border border-amber-400/50" />
          </div>
        </div>
      );
    }

    // Standard dining chair
    return (
      <div
        className={`relative select-none transition-shadow rounded-t-xl rounded-b-lg overflow-hidden ${baseClasses} ${
          isDragging ? 'scale-[1.05]' : ''
        }`}
        style={{
          width: `${w}px`,
          height: `${h}px`,
          transform: `rotate(${rot}deg)`,
        }}
      >
        <div className={`w-full h-[22%] ${backClasses}`} />
        <div className="w-[74%] h-[58%] mx-auto mt-[8%] rounded-md bg-white/55 border border-slate-300/70" />
      </div>
    );
  }

  // Table Rendering (No surrounding chairs, no guest count)
  const isRound = table.shape === 'round';
  const isBar = table.tableStyle === 'bar';
  const isBooth = table.tableStyle === 'booth';

  const tabletopSurface = isSelected
    ? 'border-2 border-orange-500 bg-orange-50 text-orange-950 ring-4 ring-orange-400/50 shadow-[0_6px_0_#fb923c,0_14px_26px_-6px_rgba(234,88,12,0.3)]'
    : isOccupied
    ? 'border-2 border-red-500 bg-rose-50/95 text-red-950 shadow-[0_6px_0_#fca5a5,0_14px_24px_-8px_rgba(220,38,38,0.28)]'
    : isBar
    ? 'border-2 border-slate-700 bg-slate-800 text-white shadow-[0_6px_0_#334155,0_12px_20px_-8px_rgba(15,23,42,0.3)]'
    : isBooth
    ? 'border-2 border-amber-600 bg-amber-50 text-amber-950 shadow-[0_6px_0_#fcd34d,0_12px_20px_-8px_rgba(180,83,9,0.2)]'
    : 'border-2 border-emerald-600 bg-white text-emerald-950 shadow-[0_6px_0_#cbd5e1,0_12px_20px_-8px_rgba(15,23,42,0.14)]';

  return (
    <div
      className={`relative select-none ${isDragging ? 'scale-[1.03]' : ''}`}
      style={{ width: `${w}px`, height: `${h}px` }}
    >
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-1 transition-shadow ${
          isRound ? 'rounded-full' : isBar ? 'rounded-xl' : 'rounded-2xl'
        } ${tabletopSurface}`}
      >
        <span
          className={`font-black leading-tight text-center truncate max-w-full px-1 ${
            compact ? 'text-[10px]' : w < 72 ? 'text-xs' : 'text-sm sm:text-base'
          }`}
        >
          {table.name}
        </span>

        {showOccupiedBadge && isOccupied && !compact && (
          <span className="text-[9px] font-black uppercase text-red-700 bg-red-100 px-1.5 py-0.5 rounded-sm mt-0.5 leading-none">
            {lang === 'th' ? 'มีลูกค้า' : 'Occupied'}
          </span>
        )}
      </div>
    </div>
  );
};

