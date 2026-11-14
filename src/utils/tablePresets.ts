import { TableDoc, TableShape, TableStylePreset } from '../types';

export interface TablePresetDef {
  id: string;
  nameEn: string;
  nameTh: string;
  descEn: string;
  descTh: string;
  shape: TableShape;
  tableStyle: TableStylePreset;
  chairs: number;
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

export const FLOOR_CANVAS_MIN_WIDTH = 960;
export const FLOOR_CANVAS_MIN_HEIGHT = 600;
export const TABLE_MIN_SIZE = 56;
export const TABLE_MAX_SIZE = 340;
export const TABLE_MIN_SCALE = 0.65;
export const TABLE_MAX_SCALE = 1.85;
export const FLOOR_GRID_SIZE = 20;

export const TABLE_PRESETS: TablePresetDef[] = [
  {
    id: 'square_2',
    nameEn: '2-Seat Square',
    nameTh: 'คู่ สี่เหลี่ยม',
    descEn: 'Compact bistro table for 2',
    descTh: 'โต๊ะ 2 ที่นั่งทรงจัตุรัส',
    shape: 'square',
    tableStyle: 'standard',
    chairs: 2,
    width: 82,
    height: 82,
  },
  {
    id: 'round_2',
    nameEn: '2-Seat Round',
    nameTh: 'คู่ โต๊ะกลม',
    descEn: 'Cafe round table for 2',
    descTh: 'โต๊ะกลมคาเฟ่ 2 ที่นั่ง',
    shape: 'round',
    tableStyle: 'standard',
    chairs: 2,
    width: 86,
    height: 86,
  },
  {
    id: 'square_4',
    nameEn: '4-Seat Square',
    nameTh: '4 ที่นั่ง จัตุรัส',
    descEn: 'Classic 4-chair dining table',
    descTh: 'โต๊ะมาตรฐาน 4 ที่นั่ง',
    shape: 'square',
    tableStyle: 'standard',
    chairs: 4,
    width: 96,
    height: 96,
  },
  {
    id: 'round_4',
    nameEn: '4-Seat Round',
    nameTh: '4 ที่นั่ง โต๊ะกลม',
    descEn: 'Round table with 4 radial chairs',
    descTh: 'โต๊ะกลม 4 ที่นั่งรอบโต๊ะ',
    shape: 'round',
    tableStyle: 'standard',
    chairs: 4,
    width: 102,
    height: 102,
  },
  {
    id: 'rect_4',
    nameEn: '4-Seat Rect',
    nameTh: '4 ที่นั่ง ผืนผ้า',
    descEn: 'Rectangular 4-seat table',
    descTh: 'โต๊ะผืนผ้า 2+2 ที่นั่ง',
    shape: 'rectangle',
    tableStyle: 'standard',
    chairs: 4,
    width: 126,
    height: 80,
  },
  {
    id: 'rect_6',
    nameEn: '6-Seat Family',
    nameTh: '6 ที่นั่ง โต๊ะยาว',
    descEn: 'Long table for 6 guests',
    descTh: 'โต๊ะยาวครอบครัว 6 ที่นั่ง',
    shape: 'rectangle',
    tableStyle: 'standard',
    chairs: 6,
    width: 164,
    height: 88,
  },
  {
    id: 'banquet_8',
    nameEn: '8-Seat Banquet',
    nameTh: '8 ที่นั่ง จัดเลี้ยง',
    descEn: 'Large group table for 8 guests',
    descTh: 'โต๊ะใหญ่กลุ่ม/จัดเลี้ยง 8 ที่นั่ง',
    shape: 'rectangle',
    tableStyle: 'standard',
    chairs: 8,
    width: 196,
    height: 98,
  },
  {
    id: 'bar_4',
    nameEn: 'Bar Counter',
    nameTh: 'เคาน์เตอร์บาร์',
    descEn: 'Counter bar with round stools',
    descTh: 'เคาน์เตอร์บาร์ 4 เก้าอี้กลม',
    shape: 'rectangle',
    tableStyle: 'bar',
    chairs: 4,
    width: 172,
    height: 58,
  },
  {
    id: 'booth_4',
    nameEn: 'VIP Sofa Booth',
    nameTh: 'บูธโซฟา VIP',
    descEn: 'Plush sofa booth seating',
    descTh: 'โต๊ะโซฟาบูธ 4 ที่นั่ง',
    shape: 'rectangle',
    tableStyle: 'booth',
    chairs: 4,
    width: 140,
    height: 92,
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

export function getDefaultTableSize(shape: TableShape, tableStyle?: TableStylePreset): { width: number; height: number } {
  if (tableStyle === 'bar') return { width: 172, height: 58 };
  if (tableStyle === 'booth') return { width: 140, height: 92 };
  if (shape === 'rectangle') return { width: 132, height: 84 };
  if (shape === 'round') return { width: 98, height: 98 };
  return { width: 94, height: 94 };
}

export function getTableDimensions(
  table: Pick<TableDoc, 'shape' | 'width' | 'height' | 'scale' | 'tableStyle'>
): {
  baseWidth: number;
  baseHeight: number;
  scale: number;
  effWidth: number;
  effHeight: number;
} {
  const defaults = getDefaultTableSize(table.shape || 'square', table.tableStyle);
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

export function getNextTableName(existingTables: Pick<TableDoc, 'name'>[]): string {
  const used = new Set(existingTables.map((t) => t.name.trim().toUpperCase()));
  let idx = existingTables.length + 1;
  while (used.has(`T${idx}`)) {
    idx += 1;
  }
  return `T${idx}`;
}

export function findOpenTablePosition(
  existingTables: TableDoc[],
  width: number,
  height: number,
  canvasWidth: number = FLOOR_CANVAS_MIN_WIDTH,
  canvasHeight: number = FLOOR_CANVAS_MIN_HEIGHT
): { x: number; y: number } {
  const stepX = Math.max(120, width + 52);
  const stepY = Math.max(120, height + 52);

  for (let y = 40; y + height + 24 <= canvasHeight; y += stepY) {
    for (let x = 40; x + width + 24 <= canvasWidth; x += stepX) {
      const overlaps = existingTables.some((tbl) => {
        const dim = getTableDimensions(tbl);
        return (
          x < tbl.x + dim.effWidth + 28 &&
          x + width + 28 > tbl.x &&
          y < tbl.y + dim.effHeight + 28 &&
          y + height + 28 > tbl.y
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
