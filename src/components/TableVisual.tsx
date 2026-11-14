import React from 'react';
import { Users } from 'lucide-react';
import { TableDoc } from '../types';
import { computeChairPositions, getTableDimensions } from '../utils/tablePresets';

interface TableVisualProps {
  table: Pick<
    TableDoc,
    'id' | 'name' | 'shape' | 'chairs' | 'width' | 'height' | 'scale' | 'rotation' | 'tableStyle' | 'currentBillId'
  >;
  isSelected?: boolean;
  isDragging?: boolean;
  isOccupied?: boolean;
  compact?: boolean;
  showOccupiedBadge?: boolean;
  scaleFactor?: number;
}

/**
 * Clean Daylight 3D table & chairs visual renderer.
 * Shared across Floor Plan Studio, Preset Thumbnails, and Live Cashier POS.
 */
export const TableVisual: React.FC<TableVisualProps> = ({
  table,
  isSelected = false,
  isDragging = false,
  isOccupied = false,
  compact = false,
  showOccupiedBadge = true,
  scaleFactor = 1,
}) => {
  const dim = getTableDimensions(table);
  const w = Math.max(40, Math.round(dim.effWidth * scaleFactor));
  const h = Math.max(40, Math.round(dim.effHeight * scaleFactor));

  const chairs = computeChairPositions(
    table.shape || 'square',
    table.tableStyle,
    table.chairs ?? 4,
    w,
    h,
    table.rotation || 0
  );

  const isRound = table.shape === 'round';
  const isBar = table.tableStyle === 'bar';
  const isBooth = table.tableStyle === 'booth';

  // Color hierarchy aligned with POS semantic colors
  const chairSurface = isOccupied
    ? 'bg-rose-200 border-rose-400'
    : isSelected
    ? 'bg-orange-200 border-orange-500'
    : isBooth
    ? 'bg-amber-200 border-amber-500'
    : 'bg-slate-200 border-slate-400';

  const chairBackSurface = isOccupied
    ? 'bg-rose-500'
    : isSelected
    ? 'bg-orange-600'
    : isBooth
    ? 'bg-amber-700'
    : 'bg-slate-500';

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
      {/* Surrounding Chairs / Stools / Booths */}
      {chairs.map((ch, idx) => {
        if (ch.kind === 'stool') {
          return (
            <div
              key={idx}
              style={{
                left: `${ch.x}px`,
                top: `${ch.y}px`,
                width: `${ch.w}px`,
                height: `${ch.h}px`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute rounded-full border shadow-[0_2px_0_rgba(15,23,42,0.2)] pointer-events-none ${chairSurface}`}
            />
          );
        }

        if (ch.kind === 'sofa') {
          return (
            <div
              key={idx}
              style={{
                left: `${ch.x}px`,
                top: `${ch.y}px`,
                width: `${ch.w}px`,
                height: `${ch.h}px`,
                transform: `translate(-50%, -50%) rotate(${ch.angle}deg)`,
              }}
              className={`absolute rounded-xl border shadow-[0_3px_0_rgba(15,23,42,0.15)] pointer-events-none overflow-hidden ${chairSurface}`}
            >
              <div className={`w-full h-1.5 ${chairBackSurface}`} />
            </div>
          );
        }

        return (
          <div
            key={idx}
            style={{
              left: `${ch.x}px`,
              top: `${ch.y}px`,
              width: `${ch.w}px`,
              height: `${ch.h}px`,
              transform: `translate(-50%, -50%) rotate(${ch.angle}deg)`,
            }}
            className={`absolute rounded-t-md rounded-b-sm border shadow-[0_2px_0_rgba(15,23,42,0.12)] pointer-events-none overflow-hidden ${chairSurface}`}
          >
            <div className={`w-full h-[3px] ${chairBackSurface}`} />
          </div>
        );
      })}

      {/* Sculpted 3D Tabletop */}
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

        {!compact && (
          <span
            className={`text-[10px] font-bold flex items-center gap-0.5 mt-0.5 ${
              isBar && !isSelected && !isOccupied ? 'text-slate-300' : 'text-slate-500'
            }`}
          >
            <Users className="w-3 h-3" />
            <span>{table.chairs}</span>
          </span>
        )}

        {showOccupiedBadge && isOccupied && !compact && (
          <span className="text-[9px] font-black uppercase text-red-700 bg-red-100 px-1.5 py-0.5 rounded-sm mt-0.5 leading-none">
            Occupied
          </span>
        )}
      </div>
    </div>
  );
};
