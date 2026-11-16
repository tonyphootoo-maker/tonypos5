import React, { useState, useEffect, useRef } from 'react';
import { TableDoc, ZoneDoc, Language } from '../types';
import { translations } from '../i18n/translations';
import { TableVisual } from './TableVisual';
import { FLOOR_CANVAS_MIN_WIDTH, FLOOR_CANVAS_MIN_HEIGHT, getDynamicCanvasSize } from '../utils/tablePresets';
import { X } from 'lucide-react';

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
  const [activeZoneId, setActiveZoneId] = useState<string>(() => zones[0]?.id || '');
  const [modalFloorScale, setModalFloorScale] = useState<number>(0.65);
  const floorBoxRef = useRef<HTMLDivElement>(null);
  const t = translations[lang];

  useEffect(() => {
    if (zones.length > 0 && !zones.some((z) => z.id === activeZoneId)) {
      setActiveZoneId(zones[0].id);
    }
  }, [zones, activeZoneId]);

  // Filter dining tables (exclude standalone chairs) according to zone
  const orderTables = tables.filter((tbl) => tbl.itemKind !== 'chair');
  const visibleTables = activeZoneId
    ? orderTables.filter((tbl) => tbl.zoneId === activeZoneId)
    : orderTables;
  const modalCanvasSize = getDynamicCanvasSize(visibleTables, FLOOR_CANVAS_MIN_WIDTH, FLOOR_CANVAS_MIN_HEIGHT);

  useEffect(() => {
    const el = floorBoxRef.current;
    if (!el) return;
    const updateScale = () => {
      const availW = Math.max(240, el.clientWidth - 8);
      setModalFloorScale(Math.min(0.68, Math.max(0.25, availW / modalCanvasSize.width)));
    };
    updateScale();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateScale);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [modalCanvasSize.width]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90dvh] flex flex-col border border-orange-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between shadow-xs">
          <h3 className="font-extrabold text-base">{t.pos.saveOrderToTable}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Zone Chip Bar at top */}
        <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center gap-2 overflow-x-auto">
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

        {/* Tables Floor Plan View */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-neutral-50/50">
          <div
            ref={floorBoxRef}
            className="relative w-full h-[360px] bg-white rounded-2xl border border-neutral-300 shadow-inner overflow-auto flex items-start"
          >
            <div
              className="kin-3d-floorplan relative shrink-0 mx-auto"
              style={{
                width: `${Math.round(modalCanvasSize.width * modalFloorScale)}px`,
                height: `${Math.round(modalCanvasSize.height * modalFloorScale)}px`,
              }}
            >
              <div className="text-[11px] font-bold text-neutral-400 absolute top-2 left-3 select-none pointer-events-none">
                Floor Plan View
              </div>
              {visibleTables.map((tbl) => {
                const isOccupied = !!tbl.currentBillId;
                const isSelected = selectedTableId === tbl.id;

                return (
                  <div
                    key={tbl.id}
                    onClick={() => onSelectTable(tbl.id)}
                    style={{
                      left: `${Math.round(tbl.x * modalFloorScale)}px`,
                      top: `${Math.round(tbl.y * modalFloorScale)}px`,
                    }}
                    className={`absolute cursor-pointer select-none ${
                      isSelected ? 'z-20' : 'z-10'
                    }`}
                  >
                    <TableVisual
                      table={tbl}
                      isSelected={isSelected}
                      isOccupied={isOccupied}
                      showOccupiedBadge={false}
                      scaleFactor={modalFloorScale}
                    />
                  </div>
                );
              })}
            </div>
          </div>
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
