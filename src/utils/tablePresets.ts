import { ChairStylePreset, TableDoc, TableShape, TableStylePreset } from '../types';

export interface TablePresetDef {
  id: string;
  nameEn: string;
  nameTh: string;
  descEn: string;
  descTh: string;
  itemKind: 'table';
  shape: TableShape;
  tableStyle: TableStylePreset;
  chairs: number;
  width: number;
  height: number;
}

export interface ChairPresetDef {
  id: string;
  nameEn: string;
  nameTh: string;
  descEn: string;
  descTh: string;
  itemKind: 'chair';
  shape: TableShape;
  chairStyle: ChairStylePreset;
  width: number;
  height: number;
}

export interface ChairVisualPoint {
  x: number; // center x relative to table box
  y: number; // center y relative to table box
  w: number; // chair width
  h: number; // chair height
  angle: number; // deg orientation
  kind: 'chair' | 'stool' | 'sofa';
}

export const FLOOR_CANVAS_MIN_WIDTH = 1200;
export const FLOOR_CANVAS_MIN_HEIGHT = 760;
export const TABLE_MIN_SIZE = 32;
export const TABLE_MAX_SIZE = 340;
export const TABLE_MIN_SCALE = 0.65;
export const TABLE_MAX_SCALE = 1.85;
export const FLOOR_GRID_SIZE = 20;

export const TABLE_ONLY_PRESETS: TablePresetDef[] = [
  {
    id: 'square_sm',
    nameEn: 'Small Square',
    nameTh: 'สี่เหลี่ยมเล็ก',
    descEn: 'Compact square table',
    descTh: 'โต๊ะจัตุรัสขนาดเล็ก',
    itemKind: 'table',
    shape: 'square',
    tableStyle: 'standard',
    chairs: 0,
    width: 78,
    height: 78,
  },
  {
    id: 'square_lg',
    nameEn: 'Large Square',
    nameTh: 'สี่เหลี่ยมใหญ่',
    descEn: 'Standard square dining table',
    descTh: 'โต๊ะจัตุรัสขนาดมาตรฐาน',
    itemKind: 'table',
    shape: 'square',
    tableStyle: 'standard',
    chairs: 0,
    width: 98,
    height: 98,
  },
  {
    id: 'round_sm',
    nameEn: 'Small Round',
    nameTh: 'โต๊ะกลมเล็ก',
    descEn: 'Compact round table',
    descTh: 'โต๊ะกลมขนาดเล็ก',
    itemKind: 'table',
    shape: 'round',
    tableStyle: 'standard',
    chairs: 0,
    width: 82,
    height: 82,
  },
  {
    id: 'round_lg',
    nameEn: 'Large Round',
    nameTh: 'โต๊ะกลมใหญ่',
    descEn: 'Spacious round dining table',
    descTh: 'โต๊ะกลมขนาดใหญ่',
    itemKind: 'table',
    shape: 'round',
    tableStyle: 'standard',
    chairs: 0,
    width: 104,
    height: 104,
  },
  {
    id: 'rect_md',
    nameEn: 'Medium Rect',
    nameTh: 'ผืนผ้ากลาง',
    descEn: 'Rectangular dining table',
    descTh: 'โต๊ะผืนผ้าขนาดกลาง',
    itemKind: 'table',
    shape: 'rectangle',
    tableStyle: 'standard',
    chairs: 0,
    width: 128,
    height: 80,
  },
  {
    id: 'rect_lg',
    nameEn: 'Long Table',
    nameTh: 'โต๊ะยาว',
    descEn: 'Extended group table',
    descTh: 'โต๊ะยาวสำหรับกลุ่มใหญ่',
    itemKind: 'table',
    shape: 'rectangle',
    tableStyle: 'standard',
    chairs: 0,
    width: 172,
    height: 88,
  },
  {
    id: 'bar_counter',
    nameEn: 'Bar Counter',
    nameTh: 'เคาน์เตอร์บาร์',
    descEn: 'Sleek bar counter surface',
    descTh: 'โต๊ะเคาน์เตอร์บาร์',
    itemKind: 'table',
    shape: 'rectangle',
    tableStyle: 'bar',
    chairs: 0,
    width: 172,
    height: 56,
  },
  {
    id: 'booth_table',
    nameEn: 'Booth Table',
    nameTh: 'โต๊ะบูธ',
    descEn: 'Warm booth dining tabletop',
    descTh: 'โต๊ะบูธไม้โทนอบอุ่น',
    itemKind: 'table',
    shape: 'rectangle',
    tableStyle: 'booth',
    chairs: 0,
    width: 136,
    height: 88,
  },
];

export const TABLE_PRESETS: TablePresetDef[] = TABLE_ONLY_PRESETS;

export const CHAIR_PRESETS: ChairPresetDef[] = [
  {
    id: 'chair_dining',
    nameEn: 'Dining Chair',
    nameTh: 'เก้าอี้เดี่ยว',
    descEn: 'Classic restaurant chair',
    descTh: 'เก้าอี้พนักพิงมาตรฐาน',
    itemKind: 'chair',
    shape: 'square',
    chairStyle: 'dining',
    width: 38,
    height: 38,
  },
  {
    id: 'chair_stool',
    nameEn: 'Round Stool',
    nameTh: 'เก้าอี้สตูลกลม',
    descEn: 'Round counter bar stool',
    descTh: 'เก้าอี้สตูลกลมสำหรับบาร์',
    itemKind: 'chair',
    shape: 'round',
    chairStyle: 'stool',
    width: 36,
    height: 36,
  },
  {
    id: 'chair_armchair',
    nameEn: 'Armchair',
    nameTh: 'อาร์มแชร์',
    descEn: 'Comfortable armchair with armrests',
    descTh: 'เก้าอี้มีที่วางแขน',
    itemKind: 'chair',
    shape: 'square',
    chairStyle: 'armchair',
    width: 46,
    height: 46,
  },
  {
    id: 'chair_sofa',
    nameEn: 'Sofa Bench',
    nameTh: 'เก้าอี้โซฟายาว',
    descEn: 'Plush booth sofa bench',
    descTh: 'โซฟายาวสำหรับนั่งคู่/บูธ',
    itemKind: 'chair',
    shape: 'rectangle',
    chairStyle: 'sofa',
    width: 96,
    height: 40,
  },
];

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function normalizeRotation(deg?: number): number {
  if (!deg || !Number.isFinite(deg)) return 0;
  const mod = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return mod;
}

export function getDefaultTableSize(
  shape: TableShape,
  tableStyle?: TableStylePreset,
  itemKind?: 'table' | 'chair',
  chairStyle?: ChairStylePreset
): { width: number; height: number } {
  if (itemKind === 'chair') {
    if (chairStyle === 'sofa') return { width: 96, height: 40 };
    if (chairStyle === 'armchair') return { width: 46, height: 46 };
    if (chairStyle === 'stool') return { width: 36, height: 36 };
    return { width: 38, height: 38 };
  }
  if (tableStyle === 'bar') return { width: 172, height: 56 };
  if (tableStyle === 'booth') return { width: 136, height: 88 };
  if (shape === 'rectangle') return { width: 128, height: 80 };
  if (shape === 'round') return { width: 98, height: 98 };
  return { width: 94, height: 94 };
}

export function getTableDimensions(
  table: Pick<TableDoc, 'shape' | 'width' | 'height' | 'scale' | 'tableStyle' | 'itemKind' | 'chairStyle'>
): {
  baseWidth: number;
  baseHeight: number;
  scale: number;
  effWidth: number;
  effHeight: number;
} {
  const defaults = getDefaultTableSize(
    table.shape || 'square',
    table.tableStyle,
    table.itemKind,
    table.chairStyle
  );
  const baseWidth = clampNumber(table.width ?? defaults.width, TABLE_MIN_SIZE, TABLE_MAX_SIZE);
  const baseHeight = clampNumber(table.height ?? defaults.height, TABLE_MIN_SIZE, TABLE_MAX_SIZE);
  const scale = clampNumber(table.scale ?? 1, TABLE_MIN_SCALE, TABLE_MAX_SCALE);
  const effWidth = Math.round(clampNumber(baseWidth * scale, TABLE_MIN_SIZE, TABLE_MAX_SIZE));
  const effHeight = Math.round(clampNumber(baseHeight * scale, TABLE_MIN_SIZE, TABLE_MAX_SIZE));
  return { baseWidth, baseHeight, scale, effWidth, effHeight };
}

export function clampTablePosition(
  x: number,
  y: number,
  tableWidth: number,
  tableHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  snapToGrid: boolean = false,
  gridSize: number = FLOOR_GRID_SIZE
): { x: number; y: number } {
  const pad = 18;
  const maxX = Math.max(pad, canvasWidth - tableWidth - pad);
  const maxY = Math.max(pad, canvasHeight - tableHeight - pad);

  let nextX = clampNumber(x, pad, maxX);
  let nextY = clampNumber(y, pad, maxY);

  if (snapToGrid && gridSize > 1) {
    nextX = clampNumber(Math.round(nextX / gridSize) * gridSize, pad, maxX);
    nextY = clampNumber(Math.round(nextY / gridSize) * gridSize, pad, maxY);
  }

  return { x: Math.round(nextX), y: Math.round(nextY) };
}

export function getNextTableName(existingItems: Pick<TableDoc, 'name' | 'itemKind'>[]): string {
  const onlyTables = existingItems.filter((t) => t.itemKind !== 'chair');
  const used = new Set(onlyTables.map((t) => t.name.trim().toUpperCase()));
  let idx = onlyTables.length + 1;
  while (used.has(`T${idx}`)) {
    idx += 1;
  }
  return `T${idx}`;
}

export function getNextChairName(existingItems: Pick<TableDoc, 'name' | 'itemKind'>[]): string {
  const onlyChairs = existingItems.filter((t) => t.itemKind === 'chair');
  const used = new Set(onlyChairs.map((t) => t.name.trim().toUpperCase()));
  let idx = onlyChairs.length + 1;
  while (used.has(`C${idx}`)) {
    idx += 1;
  }
  return `C${idx}`;
}

export function findOpenTablePosition(
  existingTables: TableDoc[],
  width: number,
  height: number,
  canvasWidth: number = FLOOR_CANVAS_MIN_WIDTH,
  canvasHeight: number = FLOOR_CANVAS_MIN_HEIGHT
): { x: number; y: number } {
  const stepX = Math.max(64, width + 32);
  const stepY = Math.max(64, height + 32);

  for (let y = 36; y + height + 24 <= canvasHeight; y += stepY) {
    for (let x = 36; x + width + 24 <= canvasWidth; x += stepX) {
      const overlaps = existingTables.some((tbl) => {
        const dim = getTableDimensions(tbl);
        return (
          x < tbl.x + dim.effWidth + 16 &&
          x + width + 16 > tbl.x &&
          y < tbl.y + dim.effHeight + 16 &&
          y + height + 16 > tbl.y
        );
      });
      if (!overlaps) {
        return { x: Math.round(x), y: Math.round(y) };
      }
    }
  }

  const offset = (existingTables.length % 6) * 28;
  return clampTablePosition(60 + offset, 60 + offset, width, height, canvasWidth, canvasHeight, true);
}

export function computeChairPositions(
  shape: TableShape,
  tableStyle: TableStylePreset | undefined,
  chairs: number,
  width: number,
  height: number,
  rotation: number = 0
): ChairVisualPoint[] {
  const count = clampNumber(Math.round(chairs || 0), 0, 20);
  if (count === 0) return [];

  const rot = normalizeRotation(rotation);
  const points: ChairVisualPoint[] = [];

  const chairW = clampNumber(Math.round(Math.min(width, height) * 0.34), 16, 28);
  const chairH = clampNumber(Math.round(chairW * 0.45), 7, 13);
  const gap = 8;

  // Bar counter: round stools lined along one long side based on rotation
  if (tableStyle === 'bar') {
    const stoolSize = clampNumber(Math.round(Math.min(width, height) * 0.38), 14, 22);
    const vertical = rot === 90 || rot === 270;
    if (vertical) {
      const sideX = rot === 90 ? width + gap : -gap;
      for (let i = 0; i < count; i++) {
        const y = ((i + 0.5) / count) * height;
        points.push({ x: sideX, y, w: stoolSize, h: stoolSize, angle: rot, kind: 'stool' });
      }
    } else {
      const sideY = rot === 180 ? height + gap : -gap;
      for (let i = 0; i < count; i++) {
        const x = ((i + 0.5) / count) * width;
        points.push({ x, y: sideY, w: stoolSize, h: stoolSize, angle: rot, kind: 'stool' });
      }
    }
    return points;
  }

  // Booth style: plush bench sofas on opposite long sides
  if (tableStyle === 'booth') {
    const vertical = rot === 90 || rot === 270;
    const sofaThickness = clampNumber(Math.round(Math.min(width, height) * 0.24), 14, 24);
    if (vertical) {
      const sofaLen = Math.max(36, height - 10);
      points.push({ x: -sofaThickness / 2 - 4, y: height / 2, w: sofaLen, h: sofaThickness, angle: 270, kind: 'sofa' });
      if (count >= 2) {
        points.push({ x: width + sofaThickness / 2 + 4, y: height / 2, w: sofaLen, h: sofaThickness, angle: 90, kind: 'sofa' });
      }
    } else {
      const sofaLen = Math.max(36, width - 10);
      points.push({ x: width / 2, y: -sofaThickness / 2 - 4, w: sofaLen, h: sofaThickness, angle: 0, kind: 'sofa' });
      if (count >= 2) {
        points.push({ x: width / 2, y: height + sofaThickness / 2 + 4, w: sofaLen, h: sofaThickness, angle: 180, kind: 'sofa' });
      }
    }
    return points;
  }

  // Round table: distribute evenly around ellipse perimeter
  if (shape === 'round') {
    const rx = width / 2 + gap;
    const ry = height / 2 + gap;
    const startRad = ((rot - 90) * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const theta = startRad + (i * Math.PI * 2) / count;
      const x = width / 2 + Math.cos(theta) * rx;
      const y = height / 2 + Math.sin(theta) * ry;
      const angle = (theta * 180) / Math.PI + 90;
      points.push({ x, y, w: chairW, h: chairH, angle, kind: 'chair' });
    }
    return points;
  }

  // Square / Rectangle table: distribute chairs cleanly across edges
  // Prioritize opposite sides first (top/bottom or left/right depending on aspect & rotation)
  const preferHorizontalLong = width >= height;
  if (count === 1) {
    const sideAngle = rot;
    if (sideAngle === 90) points.push({ x: width + gap, y: height / 2, w: chairW, h: chairH, angle: 90, kind: 'chair' });
    else if (sideAngle === 180) points.push({ x: width / 2, y: height + gap, w: chairW, h: chairH, angle: 180, kind: 'chair' });
    else if (sideAngle === 270) points.push({ x: -gap, y: height / 2, w: chairW, h: chairH, angle: 270, kind: 'chair' });
    else points.push({ x: width / 2, y: -gap, w: chairW, h: chairH, angle: 0, kind: 'chair' });
    return points;
  }

  if (count === 2) {
    const useLeftRight = rot === 90 || rot === 270 || (!preferHorizontalLong && rot === 0);
    if (useLeftRight) {
      points.push({ x: -gap, y: height / 2, w: chairW, h: chairH, angle: 270, kind: 'chair' });
      points.push({ x: width + gap, y: height / 2, w: chairW, h: chairH, angle: 90, kind: 'chair' });
    } else {
      points.push({ x: width / 2, y: -gap, w: chairW, h: chairH, angle: 0, kind: 'chair' });
      points.push({ x: width / 2, y: height + gap, w: chairW, h: chairH, angle: 180, kind: 'chair' });
    }
    return points;
  }

  if (count === 4 && Math.abs(width - height) < 24) {
    // Classic 4 sides of a square table
    points.push({ x: width / 2, y: -gap, w: chairW, h: chairH, angle: 0, kind: 'chair' });
    points.push({ x: width + gap, y: height / 2, w: chairW, h: chairH, angle: 90, kind: 'chair' });
    points.push({ x: width / 2, y: height + gap, w: chairW, h: chairH, angle: 180, kind: 'chair' });
    points.push({ x: -gap, y: height / 2, w: chairW, h: chairH, angle: 270, kind: 'chair' });
    return points;
  }

  // General N >= 3 for square/rectangle: place ends if >= 8 or tall/wide proportion matches
  let endCaps = 0;
  if (count >= 7 && preferHorizontalLong && width >= height * 1.4) {
    endCaps = 2;
  } else if (count >= 7 && !preferHorizontalLong && height >= width * 1.4) {
    endCaps = 2;
  }

  const sideTotal = count - endCaps;
  const sideA = Math.ceil(sideTotal / 2);
  const sideB = Math.floor(sideTotal / 2);

  if (preferHorizontalLong) {
    for (let i = 0; i < sideA; i++) {
      points.push({ x: ((i + 0.5) / sideA) * width, y: -gap, w: chairW, h: chairH, angle: 0, kind: 'chair' });
    }
    for (let i = 0; i < sideB; i++) {
      points.push({ x: ((i + 0.5) / sideB) * width, y: height + gap, w: chairW, h: chairH, angle: 180, kind: 'chair' });
    }
    if (endCaps === 2) {
      points.push({ x: -gap, y: height / 2, w: chairW, h: chairH, angle: 270, kind: 'chair' });
      points.push({ x: width + gap, y: height / 2, w: chairW, h: chairH, angle: 90, kind: 'chair' });
    }
  } else {
    for (let i = 0; i < sideA; i++) {
      points.push({ x: -gap, y: ((i + 0.5) / sideA) * height, w: chairW, h: chairH, angle: 270, kind: 'chair' });
    }
    for (let i = 0; i < sideB; i++) {
      points.push({ x: width + gap, y: ((i + 0.5) / sideB) * height, w: chairW, h: chairH, angle: 90, kind: 'chair' });
    }
    if (endCaps === 2) {
      points.push({ x: width / 2, y: -gap, w: chairW, h: chairH, angle: 0, kind: 'chair' });
      points.push({ x: width / 2, y: height + gap, w: chairW, h: chairH, angle: 180, kind: 'chair' });
    }
  }

  return points;
}
