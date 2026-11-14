import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TableDoc,
  ZoneDoc,
  Language,
  TableShape,
  TableStylePreset,
} from '../types';
import {
  subscribeTables,
  subscribeCollection,
  saveDocument,
  deleteDocument,
  saveTableLayoutAuto,
} from '../data/db';
import { TableVisual } from '../components/TableVisual';
import {
  TABLE_PRESETS,
  TablePresetDef,
  FLOOR_CANVAS_MIN_WIDTH,
  FLOOR_CANVAS_MIN_HEIGHT,
  FLOOR_GRID_SIZE,
  TABLE_MIN_SIZE,
  TABLE_MAX_SIZE,
  TABLE_MIN_SCALE,
  TABLE_MAX_SCALE,
  clampNumber,
  clampTablePosition,
  findOpenTablePosition,
  getNextTableName,
  getTableDimensions,
  normalizeRotation,
} from '../utils/tablePresets';
import {
  Plus,
  Trash2,
  Edit3,
  RotateCw,
  Copy,
  Maximize2,
  Minimize2,
  Grid,
  ZoomIn,
  ZoomOut,
  Check,
  X,
  ArrowLeft,
  CloudCheck,
  Loader2,
  AlertCircle,
  Move,
  SlidersHorizontal,
  Layers,
} from 'lucide-react';

interface Props {
  lang: Language;
  onNavigateToPos: () => void;
}

interface DragSession {
  mode: 'move' | 'resize';
  tableId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  hasMoved: boolean;
}

export const FloorPlanPage: React.FC<Props> = ({ lang, onNavigateToPos }) => {
  const isTh = lang === 'th';

  const [tables, setTables] = useState<TableDoc[]>([]);
  const [zones, setZones] = useState<ZoneDoc[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string>('');

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1);
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Zone management UI
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [isRenamingZone, setIsRenamingZone] = useState(false);
  const [renameZoneText, setRenameZoneText] = useState('');

  // Double-click Edit Mode modal state
  const [editingTable, setEditingTable] = useState<TableDoc | null>(null);

  // Drag/resize tracking ref (prevents stale closures & prevents click writes)
  const dragSessionRef = useRef<DragSession | null>(null);
  const tablesRef = useRef<TableDoc[]>([]);
  tablesRef.current = tables;
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubTables = subscribeTables((tbls) => {
      // Avoid overwriting the table currently being actively dragged
      const activeDrag = dragSessionRef.current;
      if (activeDrag && activeDrag.hasMoved) {
        setTables((prev) => {
          const localDragging = prev.find((t) => t.id === activeDrag.tableId);
          if (!localDragging) return tbls;
          return tbls.map((t) => (t.id === activeDrag.tableId ? { ...t, x: localDragging.x, y: localDragging.y, width: localDragging.width, height: localDragging.height } : t));
        });
      } else {
        setTables(tbls);
      }
    });

    const unsubZones = subscribeCollection<ZoneDoc>('zones', (zList) => {
      const sorted = [...zList].sort((a, b) => (a.order || 0) - (b.order || 0));
      setZones(sorted);
      setActiveZoneId((prev) => {
        if (prev && sorted.some((z) => z.id === prev)) return prev;
        return sorted[0]?.id || '';
      });
    });

    return () => {
      unsubTables();
      unsubZones();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const showNotice = (msg: string) => {
    setNoticeMsg(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNoticeMsg(null), 3200);
  };

  const persistTableToCloud = async (tbl: TableDoc, isNew: boolean = false) => {
    setSyncState('saving');
    try {
      const saved = await saveTableLayoutAuto(tbl, isNew);
      setTables((prev) => {
        const exists = prev.some((p) => p.id === saved.id);
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
      });
      setSyncState('saved');
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => setSyncState('idle'), 2000);
    } catch (err) {
      console.error('Auto-save floor plan error:', err);
      setSyncState('error');
      showNotice(
        isTh
          ? 'บันทึกขึ้น Cloud ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ'
          : 'Failed to save floor plan changes to Cloud.'
      );
    }
  };

  const zoneTables = useMemo(
    () =>
      activeZoneId
        ? tables.filter((t) => t.zoneId === activeZoneId)
        : tables,
    [tables, activeZoneId]
  );

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) || null,
    [tables, selectedTableId]
  );

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId) || null,
    [zones, activeZoneId]
  );

  // Add new table from preset at explicit or open coordinates
  const handleAddFromPreset = async (
    preset: TablePresetDef,
    dropPos?: { x: number; y: number }
  ) => {
    const targetZoneId = activeZoneId || zones[0]?.id || 'zone_main';
    const currentZoneTables = tablesRef.current.filter((t) => t.zoneId === targetZoneId);
    const pos = dropPos
      ? clampTablePosition(
          dropPos.x - preset.width / 2,
          dropPos.y - preset.height / 2,
          preset.width,
          preset.height,
          FLOOR_CANVAS_MIN_WIDTH,
          FLOOR_CANVAS_MIN_HEIGHT,
          snapToGrid
        )
      : findOpenTablePosition(
          currentZoneTables,
          preset.width,
          preset.height,
          FLOOR_CANVAS_MIN_WIDTH,
          FLOOR_CANVAS_MIN_HEIGHT
        );

    const now = new Date().toISOString();
    const newTable: TableDoc = {
      id: `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: getNextTableName(tablesRef.current),
      zoneId: targetZoneId,
      shape: preset.shape,
      tableStyle: preset.tableStyle,
      presetId: preset.id,
      chairs: preset.chairs,
      width: preset.width,
      height: preset.height,
      scale: 1,
      rotation: 0,
      x: pos.x,
      y: pos.y,
      currentBillId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    setTables((prev) => [...prev, newTable]);
    setSelectedTableId(newTable.id);
    await persistTableToCloud(newTable, true);
  };

  // Dragging & Resizing via Pointer Events (works smoothly on Mouse, Tablet, iOS, Android POS)
  const handleTablePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    tbl: TableDoc
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    setSelectedTableId(tbl.id);

    const dim = getTableDimensions(tbl);
    dragSessionRef.current = {
      mode: 'move',
      tableId: tbl.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: tbl.x,
      origY: tbl.y,
      origW: dim.effWidth,
      origH: dim.effHeight,
      hasMoved: false,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Safe fallback if capture unsupported
    }
  };

  const handleResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    tbl: TableDoc
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    setSelectedTableId(tbl.id);

    const dim = getTableDimensions(tbl);
    dragSessionRef.current = {
      mode: 'resize',
      tableId: tbl.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: tbl.x,
      origY: tbl.y,
      origW: dim.baseWidth,
      origH: dim.baseHeight,
      hasMoved: false,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Safe fallback
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    const rawDx = e.clientX - session.startClientX;
    const rawDy = e.clientY - session.startClientY;

    if (!session.hasMoved && Math.hypot(rawDx, rawDy) < 4) {
      return;
    }
    session.hasMoved = true;

    const dx = rawDx / zoom;
    const dy = rawDy / zoom;

    const target = tablesRef.current.find((t) => t.id === session.tableId);
    if (!target) return;

    if (session.mode === 'move') {
      const dim = getTableDimensions(target);
      const pos = clampTablePosition(
        session.origX + dx,
        session.origY + dy,
        dim.effWidth,
        dim.effHeight,
        FLOOR_CANVAS_MIN_WIDTH,
        FLOOR_CANVAS_MIN_HEIGHT,
        snapToGrid
      );

      setTables((prev) =>
        prev.map((t) =>
          t.id === session.tableId ? { ...t, x: pos.x, y: pos.y } : t
        )
      );
    } else if (session.mode === 'resize') {
      const scale = target.scale ?? 1;
      const deltaBaseW = dx / scale;
      const deltaBaseH = dy / scale;

      let nextW = clampNumber(
        Math.round(session.origW + deltaBaseW),
        TABLE_MIN_SIZE,
        TABLE_MAX_SIZE
      );
      let nextH = clampNumber(
        Math.round(session.origH + deltaBaseH),
        TABLE_MIN_SIZE,
        TABLE_MAX_SIZE
      );

      // Keep round tables circular while resizing
      if (target.shape === 'round') {
        const unified = Math.max(nextW, nextH);
        nextW = unified;
        nextH = unified;
      }

      if (snapToGrid) {
        nextW = clampNumber(Math.round(nextW / 10) * 10, TABLE_MIN_SIZE, TABLE_MAX_SIZE);
        nextH = clampNumber(Math.round(nextH / 10) * 10, TABLE_MIN_SIZE, TABLE_MAX_SIZE);
      }

      const effW = Math.round(nextW * scale);
      const effH = Math.round(nextH * scale);
      const clampedPos = clampTablePosition(
        target.x,
        target.y,
        effW,
        effH,
        FLOOR_CANVAS_MIN_WIDTH,
        FLOOR_CANVAS_MIN_HEIGHT,
        false
      );

      setTables((prev) =>
        prev.map((t) =>
          t.id === session.tableId
            ? { ...t, width: nextW, height: nextH, x: clampedPos.x, y: clampedPos.y }
            : t
        )
      );
    }
  };

  const handlePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    const didMove = session.hasMoved;
    const tableId = session.tableId;
    dragSessionRef.current = null;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Safe ignore
    }

    if (didMove) {
      const latest = tablesRef.current.find((t) => t.id === tableId);
      if (latest) {
        await persistTableToCloud(latest, false);
      }
    }
  };

  // Drag preset from palette directly onto canvas (HTML5 DnD for desktop)
  const handleCanvasDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleCanvasDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const presetId = e.dataTransfer.getData('text/kinpos-table-preset');
    const preset = TABLE_PRESETS.find((p) => p.id === presetId);
    if (!preset || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    await handleAddFromPreset(preset, { x, y });
  };

  // Quick scale / resize controls (ย่อ - ขยาย)
  const handleAdjustScale = async (tbl: TableDoc, delta: number) => {
    const currentScale = tbl.scale ?? 1;
    const nextScale = Number(
      clampNumber(currentScale + delta, TABLE_MIN_SCALE, TABLE_MAX_SCALE).toFixed(2)
    );
    const preview: TableDoc = { ...tbl, scale: nextScale };
    const dim = getTableDimensions(preview);
    const pos = clampTablePosition(
      tbl.x,
      tbl.y,
      dim.effWidth,
      dim.effHeight,
      FLOOR_CANVAS_MIN_WIDTH,
      FLOOR_CANVAS_MIN_HEIGHT,
      false
    );
    const updated: TableDoc = { ...preview, x: pos.x, y: pos.y };
    setTables((prev) => prev.map((t) => (t.id === tbl.id ? updated : t)));
    await persistTableToCloud(updated, false);
  };

  // Rotate 90 degrees
  const handleRotateTable = async (tbl: TableDoc) => {
    const dim = getTableDimensions(tbl);
    const nextRotation = normalizeRotation((tbl.rotation || 0) + 90);
    const shouldSwapDims = tbl.shape !== 'round' && dim.baseWidth !== dim.baseHeight;
    const nextW = shouldSwapDims ? dim.baseHeight : dim.baseWidth;
    const nextH = shouldSwapDims ? dim.baseWidth : dim.baseHeight;

    const nextEffW = Math.round(nextW * dim.scale);
    const nextEffH = Math.round(nextH * dim.scale);
    const pos = clampTablePosition(
      tbl.x,
      tbl.y,
      nextEffW,
      nextEffH,
      FLOOR_CANVAS_MIN_WIDTH,
      FLOOR_CANVAS_MIN_HEIGHT,
      false
    );

    const updated: TableDoc = {
      ...tbl,
      width: nextW,
      height: nextH,
      rotation: nextRotation,
      x: pos.x,
      y: pos.y,
    };
    setTables((prev) => prev.map((t) => (t.id === tbl.id ? updated : t)));
    await persistTableToCloud(updated, false);
  };

  // Duplicate selected table
  const handleDuplicateTable = async (tbl: TableDoc) => {
    const dim = getTableDimensions(tbl);
    const pos = clampTablePosition(
      tbl.x + 36,
      tbl.y + 36,
      dim.effWidth,
      dim.effHeight,
      FLOOR_CANVAS_MIN_WIDTH,
      FLOOR_CANVAS_MIN_HEIGHT,
      snapToGrid
    );

    const now = new Date().toISOString();
    const cloned: TableDoc = {
      ...tbl,
      id: `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: getNextTableName(tablesRef.current),
      x: pos.x,
      y: pos.y,
      currentBillId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    setTables((prev) => [...prev, cloned]);
    setSelectedTableId(cloned.id);
    await persistTableToCloud(cloned, true);
  };

  // Delete table (safe guard if occupied)
  const handleDeleteTable = async (tbl: TableDoc) => {
    if (tbl.currentBillId) {
      showNotice(
        isTh
          ? `ไม่สามารถลบโต๊ะ ${tbl.name} ได้ เนื่องจากยังมีบิลเปิดค้างอยู่`
          : `Cannot delete ${tbl.name} while it has an active open bill.`
      );
      return;
    }

    setSyncState('saving');
    try {
      await deleteDocument('tables', tbl.id);
      setTables((prev) => prev.filter((t) => t.id !== tbl.id));
      if (selectedTableId === tbl.id) setSelectedTableId(null);
      if (editingTable?.id === tbl.id) setEditingTable(null);
      setSyncState('saved');
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => setSyncState('idle'), 2000);
    } catch (err) {
      console.error('Delete table error:', err);
      setSyncState('error');
    }
  };

  // Save Double-Click Edit Modal
  const handleSaveEditModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTable || !editingTable.name.trim()) return;

    const dim = getTableDimensions(editingTable);
    const pos = clampTablePosition(
      editingTable.x,
      editingTable.y,
      dim.effWidth,
      dim.effHeight,
      FLOOR_CANVAS_MIN_WIDTH,
      FLOOR_CANVAS_MIN_HEIGHT,
      false
    );

    const updated: TableDoc = {
      ...editingTable,
      name: editingTable.name.trim(),
      chairs: clampNumber(editingTable.chairs || 1, 0, 20),
      width: dim.baseWidth,
      height: dim.baseHeight,
      scale: dim.scale,
      x: pos.x,
      y: pos.y,
    };

    setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setEditingTable(null);
    await persistTableToCloud(updated, false);
  };

  // Zone CRUD
  const handleCreateZone = async () => {
    if (!newZoneName.trim()) return;
    const newZone: ZoneDoc = {
      id: `zone_${Date.now()}`,
      name: newZoneName.trim(),
      nameTh: newZoneName.trim(),
      order: zones.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    await saveDocument('zones', newZone, true);
    setZones((prev) => [...prev, newZone]);
    setActiveZoneId(newZone.id);
    setNewZoneName('');
    setIsAddingZone(false);
  };

  const handleRenameZone = async () => {
    if (!activeZone || !renameZoneText.trim()) return;
    const updated: ZoneDoc = {
      ...activeZone,
      name: renameZoneText.trim(),
      nameTh: renameZoneText.trim(),
    };
    await saveDocument('zones', updated, false);
    setIsRenamingZone(false);
  };

  const handleDeleteZone = async (zone: ZoneDoc) => {
    const count = tables.filter((t) => t.zoneId === zone.id).length;
    if (count > 0) {
      showNotice(
        isTh
          ? `กรุณาลบหรือย้ายโต๊ะทั้ง ${count} ตัวออกจากโซน "${zone.nameTh || zone.name}" ก่อนลบโซน`
          : `Remove or move all ${count} tables out of "${zone.name}" before deleting this zone.`
      );
      return;
    }
    if (zones.length <= 1) {
      showNotice(
        isTh
          ? 'ต้องมีอย่างน้อย 1 โซนในผังร้าน'
          : 'At least 1 seating zone is required.'
      );
      return;
    }
    await deleteDocument('zones', zone.id);
    const remaining = zones.filter((z) => z.id !== zone.id);
    setActiveZoneId(remaining[0]?.id || '');
  };

  // Keyboard shortcuts for convenience
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editingTable) {
        if (e.key === 'Escape') setEditingTable(null);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        setSelectedTableId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingTable]);

  return (
    <div className="flex flex-col h-[calc(100vh-62px)] overflow-hidden select-none">
      {/* Top Workspace Control Bar */}
      <div className="px-3 sm:px-5 py-2.5 bg-white/95 backdrop-blur-md border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 shadow-[0_4px_14px_-6px_rgba(15,23,42,0.08)] z-20">
        {/* Left: Back to POS + Title + Zone Chips */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <button
            type="button"
            onClick={onNavigateToPos}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-[0_2px_0_#e2e8f0] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer active:translate-y-[1px]"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-orange-600" />
            <span>{isTh ? 'หน้าขาย POS' : 'POS View'}</span>
          </button>

          <div className="h-6 w-px bg-slate-200 hidden sm:block" />

          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 text-white flex items-center justify-center shadow-xs">
              <Layers className="w-4 h-4" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-black text-slate-900">
                {isTh ? 'จัดการผังโต๊ะ (Floor Plan)' : 'Floor Plan Studio'}
              </h1>
              <p className="text-[10px] font-semibold text-slate-500">
                {isTh
                  ? 'ลากวาง ย่อ-ขยาย และดับเบิลคลิกที่โต๊ะเพื่อแก้ไข • บันทึก Cloud อัตโนมัติ'
                  : 'Drag to move, resize handles, double-click to edit • Auto-saves to Cloud'}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Grid Snap, Zoom, Cloud Auto-Save Status */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Cloud Sync Feedback */}
          <div
            className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border ${
              syncState === 'saving'
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : syncState === 'error'
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            {syncState === 'saving' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                <span>{isTh ? 'กำลังบันทึก...' : 'Saving...'}</span>
              </>
            ) : syncState === 'error' ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                <span>{isTh ? 'ซิงค์ผิดพลาด' : 'Sync Error'}</span>
              </>
            ) : (
              <>
                <CloudCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>{isTh ? 'บันทึก Cloud อัตโนมัติ' : 'Cloud Auto-Saved'}</span>
              </>
            )}
          </div>

          {/* Snap to Grid */}
          <button
            type="button"
            onClick={() => setSnapToGrid((v) => !v)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border cursor-pointer transition-all ${
              snapToGrid
                ? 'bg-orange-50 text-orange-800 border-orange-300 shadow-[0_2px_0_#fed7aa]'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 shadow-[0_2px_0_#e2e8f0]'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>{isTh ? 'จัดแนวกริด' : 'Snap Grid'}</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-[0_2px_0_#e2e8f0] overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => clampNumber(Number((z - 0.15).toFixed(2)), 0.65, 1.45))}
              className="p-1.5 hover:bg-slate-50 text-slate-700 cursor-pointer"
              title={isTh ? 'ซูมออก' : 'Zoom Out'}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="px-2 py-1 text-[11px] font-black text-slate-700 border-x border-slate-200 hover:bg-slate-50 cursor-pointer tabular-nums"
              title={isTh ? 'รีเซ็ตซูม 100%' : 'Reset Zoom'}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => clampNumber(Number((z + 0.15).toFixed(2)), 0.65, 1.45))}
              className="p-1.5 hover:bg-slate-50 text-slate-700 cursor-pointer"
              title={isTh ? 'ซูมเข้า' : 'Zoom In'}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Zone Tabs Sub-bar */}
      <div className="px-3 sm:px-5 py-2 bg-slate-50/95 border-b border-slate-200 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 shrink-0 mr-1">
            {isTh ? 'โซนที่นั่ง:' : 'Zones:'}
          </span>

          {zones.map((z) => {
            const isActive = activeZoneId === z.id;
            const tableCount = tables.filter((tbl) => tbl.zoneId === z.id).length;
            return (
              <button
                key={z.id}
                type="button"
                onClick={() => {
                  setActiveZoneId(z.id);
                  setSelectedTableId(null);
                  setIsRenamingZone(false);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 active:translate-y-[1px] ${
                  isActive
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-[0_3px_0_#c2410c,0_6px_14px_-4px_rgba(234,88,12,0.3)]'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-[0_2px_0_#e2e8f0]'
                }`}
              >
                <span>{isTh && z.nameTh ? z.nameTh : z.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md font-bold ${
                    isActive ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {tableCount}
                </span>
              </button>
            );
          })}

          {isAddingZone ? (
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-orange-300 shadow-xs shrink-0">
              <input
                type="text"
                autoFocus
                placeholder={isTh ? 'ชื่อโซนใหม่...' : 'Zone name...'}
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateZone();
                  if (e.key === 'Escape') setIsAddingZone(false);
                }}
                className="px-2.5 py-1 text-xs w-32 bg-slate-50 rounded-lg border border-slate-300 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleCreateZone}
                className="p-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsAddingZone(false)}
                className="p-1.5 text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAddingZone(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-orange-700 bg-white hover:bg-orange-50 border border-dashed border-orange-300 whitespace-nowrap cursor-pointer flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isTh ? 'เพิ่มโซน' : 'Add Zone'}</span>
            </button>
          )}
        </div>

        {/* Active Zone Rename / Delete */}
        {activeZone && (
          <div className="flex items-center gap-1.5 shrink-0">
            {isRenamingZone ? (
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-orange-300">
                <input
                  type="text"
                  autoFocus
                  value={renameZoneText}
                  onChange={(e) => setRenameZoneText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameZone();
                    if (e.key === 'Escape') setIsRenamingZone(false);
                  }}
                  className="px-2 py-1 text-xs w-28 bg-slate-50 rounded-lg border border-slate-300 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={handleRenameZone}
                  className="p-1 bg-emerald-600 text-white rounded-lg cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsRenamingZone(false)}
                  className="p-1 text-slate-500 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRenameZoneText(isTh && activeZone.nameTh ? activeZone.nameTh : activeZone.name);
                    setIsRenamingZone(true);
                  }}
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 cursor-pointer flex items-center gap-1"
                  title={isTh ? 'เปลี่ยนชื่อโซน' : 'Rename zone'}
                >
                  <Edit3 className="w-3 h-3" />
                  <span className="hidden sm:inline">{isTh ? 'แก้ชื่อโซน' : 'Rename'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteZone(activeZone)}
                  className="p-1.5 rounded-xl text-rose-600 bg-white hover:bg-rose-50 border border-slate-200 cursor-pointer"
                  title={isTh ? 'ลบโซนนี้' : 'Delete zone'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Warning Notice Banner if any */}
      {noticeMsg && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{noticeMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setNoticeMsg(null)}
            className="p-1 text-rose-500 hover:text-rose-800 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Split Workspace: Left Table & Chair Presets + Right Interactive Floor Canvas */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Palette: Table & Chair Sample Templates */}
        <aside className="lg:w-72 xl:w-80 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0 z-10 shadow-[4px_0_20px_-10px_rgba(15,23,42,0.08)]">
          <div className="px-4 py-3 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/70">
            <div>
              <h2 className="text-xs sm:text-sm font-black text-slate-900">
                {isTh ? 'ตัวอย่างโต๊ะและเก้าอี้' : 'Table & Chair Templates'}
              </h2>
              <p className="text-[11px] text-slate-500 font-medium">
                {isTh
                  ? 'กดเลือกหรือลากไปวางบนผังร้าน'
                  : 'Click or drag any template onto the floor'}
              </p>
            </div>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-orange-100 text-orange-700 border border-orange-200">
              {TABLE_PRESETS.length}
            </span>
          </div>

          {/* Preset Templates Grid (Horizontal scroll on small screens, 2-col grid on desktop) */}
          <div className="p-3 flex lg:grid lg:grid-cols-2 gap-2.5 overflow-x-auto lg:overflow-y-auto flex-1">
            {TABLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/kinpos-table-preset', preset.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => handleAddFromPreset(preset)}
                className="group min-w-[136px] lg:min-w-0 bg-slate-50/80 hover:bg-orange-50/60 border border-slate-200 hover:border-orange-400 rounded-2xl p-2.5 flex flex-col items-center justify-between gap-2 transition-all cursor-pointer shadow-[inset_0_1px_0_#fff,0_2px_0_#e2e8f0] hover:-translate-y-0.5 hover:shadow-[0_4px_0_#fdba74,0_10px_18px_-8px_rgba(234,88,12,0.2)] active:translate-y-[1px]"
              >
                <div className="h-[68px] w-full flex items-center justify-center pointer-events-none overflow-hidden">
                  <TableVisual
                    table={{
                      id: preset.id,
                      name: `${preset.chairs}`,
                      shape: preset.shape,
                      chairs: preset.chairs,
                      width: preset.width,
                      height: preset.height,
                      tableStyle: preset.tableStyle,
                    }}
                    compact
                    showOccupiedBadge={false}
                    scaleFactor={0.42}
                  />
                </div>
                <div className="text-center w-full">
                  <div className="text-xs font-extrabold text-slate-800 group-hover:text-orange-700 truncate">
                    {isTh ? preset.nameTh : preset.nameEn}
                  </div>
                  <div className="text-[10px] font-semibold text-slate-500">
                    {preset.chairs} {isTh ? 'ที่นั่ง' : 'seats'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Center/Right: Interactive Floor Plan Canvas + Floating Control Bar */}
        <div className="flex-1 flex flex-col overflow-hidden relative bg-slate-100/60">
          {/* Selected Table Quick Resize / Action Toolbar */}
          <div className="px-3 sm:px-4 py-2 bg-white/95 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 min-h-[48px]">
            {selectedTable ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 rounded-lg bg-orange-100 text-orange-800 border border-orange-200 text-xs font-black">
                    {selectedTable.name}
                  </span>
                  <span className="text-xs font-bold text-slate-500 tabular-nums">
                    {(() => {
                      const d = getTableDimensions(selectedTable);
                      return `${d.effWidth}×${d.effHeight}px • ${selectedTable.chairs} ${isTh ? 'ที่นั่ง' : 'seats'}`;
                    })()}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Shrink / Enlarge (ย่อ - ขยาย) */}
                  <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-[0_2px_0_#e2e8f0]">
                    <button
                      type="button"
                      onClick={() => handleAdjustScale(selectedTable, -0.1)}
                      className="px-2.5 py-1.5 hover:bg-white text-slate-800 text-xs font-extrabold flex items-center gap-1 cursor-pointer"
                      title={isTh ? 'ย่อขนาดโต๊ะ' : 'Shrink table'}
                    >
                      <Minimize2 className="w-3.5 h-3.5 text-orange-600" />
                      <span>{isTh ? 'ย่อ' : 'Smaller'}</span>
                    </button>
                    <span className="px-2 text-[11px] font-black text-slate-600 border-x border-slate-200 tabular-nums">
                      {Math.round((selectedTable.scale ?? 1) * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAdjustScale(selectedTable, 0.1)}
                      className="px-2.5 py-1.5 hover:bg-white text-slate-800 text-xs font-extrabold flex items-center gap-1 cursor-pointer"
                      title={isTh ? 'ขยายขนาดโต๊ะ' : 'Enlarge table'}
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-orange-600" />
                      <span>{isTh ? 'ขยาย' : 'Larger'}</span>
                    </button>
                  </div>

                  {/* Rotate 90° */}
                  <button
                    type="button"
                    onClick={() => handleRotateTable(selectedTable)}
                    className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-[0_2px_0_#e2e8f0] text-xs font-bold flex items-center gap-1 cursor-pointer active:translate-y-[1px]"
                    title={isTh ? 'หมุน 90°' : 'Rotate 90°'}
                  >
                    <RotateCw className="w-3.5 h-3.5 text-slate-600" />
                    <span className="hidden sm:inline">{isTh ? 'หมุน' : 'Rotate'}</span>
                  </button>

                  {/* Duplicate */}
                  <button
                    type="button"
                    onClick={() => handleDuplicateTable(selectedTable)}
                    className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-[0_2px_0_#e2e8f0] text-xs font-bold flex items-center gap-1 cursor-pointer active:translate-y-[1px]"
                    title={isTh ? 'ทำซ้ำโต๊ะ' : 'Duplicate table'}
                  >
                    <Copy className="w-3.5 h-3.5 text-slate-600" />
                    <span className="hidden sm:inline">{isTh ? 'ทำซ้ำ' : 'Duplicate'}</span>
                  </button>

                  {/* Edit Modal */}
                  <button
                    type="button"
                    onClick={() => setEditingTable(selectedTable)}
                    className="px-3 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 shadow-[0_2px_0_#fed7aa] text-xs font-extrabold flex items-center gap-1 cursor-pointer active:translate-y-[1px]"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{isTh ? 'แก้ไข' : 'Edit'}</span>
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => handleDeleteTable(selectedTable)}
                    className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 shadow-[0_2px_0_#fecdd3] text-xs font-bold flex items-center gap-1 cursor-pointer active:translate-y-[1px]"
                    title={isTh ? 'ลบโต๊ะ' : 'Delete table'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between w-full text-xs text-slate-500 font-semibold">
                <div className="flex items-center gap-2">
                  <Move className="w-4 h-4 text-orange-500 shrink-0" />
                  <span>
                    {isTh
                      ? 'แตะที่โต๊ะเพื่อเลือก/ย่อ-ขยาย • ลากย้ายตำแหน่งอิสระ • ดับเบิลคลิกที่โต๊ะเพื่อแก้ไขทันที'
                      : 'Click a table to resize/rotate • Drag freely anywhere • Double-click any table to edit'}
                  </span>
                </div>
                <span className="hidden md:inline text-[11px] font-bold text-slate-400">
                  {zoneTables.length} {isTh ? 'โต๊ะในโซนนี้' : 'tables in zone'}
                </span>
              </div>
            )}
          </div>

          {/* Scrollable Floor Canvas Viewport */}
          <div
            onClick={() => setSelectedTableId(null)}
            className="flex-1 overflow-auto p-4 sm:p-6"
          >
            <div
              className="mx-auto origin-top-left transition-transform duration-150"
              style={{
                width: `${Math.round(FLOOR_CANVAS_MIN_WIDTH * zoom)}px`,
                height: `${Math.round(FLOOR_CANVAS_MIN_HEIGHT * zoom)}px`,
              }}
            >
              <div
                ref={canvasRef}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setSelectedTableId(null);
                  }
                }}
                style={{
                  width: `${FLOOR_CANVAS_MIN_WIDTH}px`,
                  height: `${FLOOR_CANVAS_MIN_HEIGHT}px`,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                }}
                className="kin-3d-floorplan relative rounded-3xl border-2 border-slate-300/90 shadow-[inset_0_2px_12px_rgba(15,23,42,0.06),0_12px_30px_-12px_rgba(15,23,42,0.16)] overflow-hidden"
              >
                {/* Subtle Zone Watermark Header */}
                <div className="absolute top-3 left-4 pointer-events-none flex items-center gap-2 text-slate-400/80">
                  <span className="text-xs font-black uppercase tracking-wider">
                    {activeZone
                      ? isTh && activeZone.nameTh
                        ? activeZone.nameTh
                        : activeZone.name
                      : isTh
                      ? 'ผังโต๊ะร้านอาหาร'
                      : 'Floor Plan'}
                  </span>
                  <span className="text-[11px] font-bold">
                    ({FLOOR_CANVAS_MIN_WIDTH}×{FLOOR_CANVAS_MIN_HEIGHT})
                  </span>
                </div>

                {/* Empty Zone Prompt */}
                {zoneTables.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
                    <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-[0_4px_0_#e2e8f0] flex items-center justify-center mb-3">
                      <Layers className="w-7 h-7 text-orange-400" />
                    </div>
                    <p className="text-sm font-black text-slate-600">
                      {isTh ? 'โซนนี้ยังไม่มีโต๊ะอาหาร' : 'No tables in this zone yet'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">
                      {isTh
                        ? 'เลือกตัวอย่างโต๊ะและเก้าอี้จากแถบด้านซ้ายเพื่อวางลงบนผังร้านทันที'
                        : 'Click or drag any table template from the left palette to place it here.'}
                    </p>
                  </div>
                )}

                {/* Draggable, Resizable, Double-Clickable Tables */}
                {zoneTables.map((tbl) => {
                  const isSelected = selectedTableId === tbl.id;
                  const isOccupied = !!tbl.currentBillId;
                  const isBeingDragged =
                    dragSessionRef.current?.tableId === tbl.id &&
                    dragSessionRef.current?.hasMoved;

                  return (
                    <div
                      key={tbl.id}
                      onPointerDown={(e) => handleTablePointerDown(e, tbl)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTableId(tbl.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelectedTableId(tbl.id);
                        setEditingTable(tbl);
                      }}
                      style={{
                        left: `${tbl.x}px`,
                        top: `${tbl.y}px`,
                      }}
                      className={`absolute cursor-grab active:cursor-grabbing touch-none ${
                        isSelected ? 'z-30' : 'z-10'
                      }`}
                      title={
                        isTh
                          ? 'ลากเพื่อย้าย • ดับเบิลคลิกเพื่อแก้ไข'
                          : 'Drag to move • Double-click to edit'
                      }
                    >
                      <TableVisual
                        table={tbl}
                        isSelected={isSelected}
                        isDragging={Boolean(isBeingDragged)}
                        isOccupied={isOccupied}
                      />

                      {/* Corner Resize Handle when table is selected */}
                      {isSelected && (
                        <>
                          <div
                            onPointerDown={(e) => handleResizePointerDown(e, tbl)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            title={
                              isTh
                                ? 'ลากมุมนี้เพื่อย่อ-ขยายขนาดโต๊ะ'
                                : 'Drag corner to resize table'
                            }
                            className="absolute -bottom-3 -right-3 w-6 h-6 rounded-full bg-orange-600 hover:bg-orange-500 border-2 border-white shadow-[0_3px_8px_rgba(15,23,42,0.35)] flex items-center justify-center cursor-nwse-resize touch-none z-40"
                          >
                            <div className="w-2 h-2 border-r-2 border-b-2 border-white" />
                          </div>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTable(tbl);
                            }}
                            title={isTh ? 'แก้ไขโต๊ะ' : 'Edit table'}
                            className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-slate-900 hover:bg-orange-600 text-white border-2 border-white shadow-md flex items-center justify-center cursor-pointer z-40"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Double-Click Instant Edit Table Modal */}
      {editingTable && (
        <div
          onClick={() => setEditingTable(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-neutral-950/60 backdrop-blur-xs"
        >
          <form
            onSubmit={handleSaveEditModal}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col border border-orange-200 overflow-hidden"
          >
            {/* Modal Header */}
            <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-extrabold text-base">
                  {isTh ? `แก้ไขโต๊ะ: ${editingTable.name}` : `Edit Table: ${editingTable.name}`}
                </h3>
                <p className="text-[11px] text-orange-100 font-medium">
                  {isTh
                    ? 'ปรับแต่งรูปแบบ เก้าอี้ ขนาด และบันทึกขึ้น Cloud อัตโนมัติ'
                    : 'Customize style, seating, size and save directly to Cloud'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTable(null)}
                className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Live Visual Preview */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center min-h-[156px] relative">
                <span className="absolute top-2 left-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {isTh ? 'ตัวอย่างจริง' : 'Live Preview'}
                </span>
                <TableVisual
                  table={editingTable}
                  isOccupied={!!editingTable.currentBillId}
                  scaleFactor={0.82}
                />
              </div>

              {/* Name & Zone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isTh ? 'ชื่อ / หมายเลขโต๊ะ' : 'Table Name / Number'}
                  </label>
                  <input
                    type="text"
                    required
                    value={editingTable.name}
                    onChange={(e) =>
                      setEditingTable({ ...editingTable, name: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:border-orange-500"
                    placeholder="T1, VIP 1..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isTh ? 'โซนที่นั่ง' : 'Seating Zone'}
                  </label>
                  <select
                    value={editingTable.zoneId}
                    onChange={(e) =>
                      setEditingTable({ ...editingTable, zoneId: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:border-orange-500"
                  >
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {isTh && z.nameTh ? z.nameTh : z.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quick Switch Template Style */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isTh ? 'เปลี่ยนรูปแบบจากตัวอย่างสำเร็จรูป' : 'Apply Table & Chair Template'}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {TABLE_PRESETS.map((preset) => {
                    const isCurrent = editingTable.presetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setEditingTable({
                            ...editingTable,
                            shape: preset.shape,
                            tableStyle: preset.tableStyle,
                            presetId: preset.id,
                            chairs: preset.chairs,
                            width: preset.width,
                            height: preset.height,
                          })
                        }
                        className={`px-2 py-2 rounded-xl border text-left transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-orange-50 border-orange-500 text-orange-900 ring-1 ring-orange-400'
                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="text-[11px] font-extrabold truncate">
                          {isTh ? preset.nameTh : preset.nameEn}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {preset.chairs} {isTh ? 'ที่นั่ง' : 'seats'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Shape, Style, Chairs, Rotation */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isTh ? 'รูปทรงโต๊ะ' : 'Shape'}
                  </label>
                  <select
                    value={editingTable.shape}
                    onChange={(e) =>
                      setEditingTable({
                        ...editingTable,
                        shape: e.target.value as TableShape,
                        presetId: undefined,
                      })
                    }
                    className="w-full px-2.5 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="square">{isTh ? 'จัตุรัส' : 'Square'}</option>
                    <option value="round">{isTh ? 'โต๊ะกลม' : 'Round'}</option>
                    <option value="rectangle">{isTh ? 'ผืนผ้า' : 'Rectangle'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isTh ? 'สไตล์เก้าอี้' : 'Chair Style'}
                  </label>
                  <select
                    value={editingTable.tableStyle || 'standard'}
                    onChange={(e) =>
                      setEditingTable({
                        ...editingTable,
                        tableStyle: e.target.value as TableStylePreset,
                        presetId: undefined,
                      })
                    }
                    className="w-full px-2.5 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="standard">{isTh ? 'เก้าอี้เดี่ยว' : 'Chairs'}</option>
                    <option value="booth">{isTh ? 'โซฟาบูธ' : 'Booth Sofa'}</option>
                    <option value="bar">{isTh ? 'เก้าอี้บาร์' : 'Bar Stools'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isTh ? 'จำนวนที่นั่ง' : 'Chairs'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={editingTable.chairs}
                    onChange={(e) =>
                      setEditingTable({
                        ...editingTable,
                        chairs: clampNumber(parseInt(e.target.value, 10) || 0, 0, 20),
                      })
                    }
                    className="w-full px-2.5 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isTh ? 'มุมหมุน' : 'Rotation'}
                  </label>
                  <select
                    value={normalizeRotation(editingTable.rotation)}
                    onChange={(e) =>
                      setEditingTable({
                        ...editingTable,
                        rotation: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full px-2.5 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  >
                    <option value={0}>0°</option>
                    <option value={90}>90°</option>
                    <option value={180}>180°</option>
                    <option value={270}>270°</option>
                  </select>
                </div>
              </div>

              {/* Resize / Scale Fine-Tuning (ย่อ - ขยาย) */}
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800">
                    {isTh ? 'ย่อ-ขยายขนาดโต๊ะ (Resize & Scale)' : 'Table Dimensions & Scale'}
                  </span>
                  <span className="text-[11px] font-black text-orange-600 tabular-nums">
                    {(() => {
                      const d = getTableDimensions(editingTable);
                      return `${d.effWidth}×${d.effHeight}px (${Math.round(d.scale * 100)}%)`;
                    })()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-600 mb-1">
                      <span>{isTh ? 'กว้าง (W)' : 'Width'}</span>
                      <span className="tabular-nums">{getTableDimensions(editingTable).baseWidth}px</span>
                    </div>
                    <input
                      type="range"
                      min={TABLE_MIN_SIZE}
                      max={TABLE_MAX_SIZE}
                      step={4}
                      value={getTableDimensions(editingTable).baseWidth}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setEditingTable({
                          ...editingTable,
                          width: val,
                          ...(editingTable.shape === 'round' ? { height: val } : {}),
                        });
                      }}
                      className="w-full accent-orange-600 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-600 mb-1">
                      <span>{isTh ? 'สูง (H)' : 'Height'}</span>
                      <span className="tabular-nums">{getTableDimensions(editingTable).baseHeight}px</span>
                    </div>
                    <input
                      type="range"
                      min={TABLE_MIN_SIZE}
                      max={TABLE_MAX_SIZE}
                      step={4}
                      value={getTableDimensions(editingTable).baseHeight}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setEditingTable({
                          ...editingTable,
                          height: val,
                          ...(editingTable.shape === 'round' ? { width: val } : {}),
                        });
                      }}
                      className="w-full accent-orange-600 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-600 mb-1">
                      <span>{isTh ? 'สเกล (ย่อ/ขยาย)' : 'Scale'}</span>
                      <span className="tabular-nums">{Math.round((editingTable.scale ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={TABLE_MIN_SCALE}
                      max={TABLE_MAX_SCALE}
                      step={0.05}
                      value={editingTable.scale ?? 1}
                      onChange={(e) =>
                        setEditingTable({
                          ...editingTable,
                          scale: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-orange-600 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleDeleteTable(editingTable)}
                className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isTh ? 'ลบโต๊ะ' : 'Delete'}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTable(null)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                >
                  {isTh ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-black shadow-md cursor-pointer hover:brightness-105"
                >
                  {isTh ? 'บันทึกการแก้ไข' : 'Save Changes'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
