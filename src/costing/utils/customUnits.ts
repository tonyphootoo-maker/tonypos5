import { localizeUnit } from '../../utils/thaiToEnglish';

export const CUSTOM_PURCHASE_UNITS_STORAGE_KEY = 'tonys_custom_purchase_units_v1';
export const CUSTOM_PORTION_UNITS_STORAGE_KEY = 'kinpos_custom_portion_units';

export const DEFAULT_PURCHASE_UNITS: string[] = [
  'g',
  'kg',
  'ml',
  'L',
  'ชิ้น',
  'กล่อง',
  'ถุง',
  'แพ็ค',
  'ขวด',
  'ฟอง',
  'ตัว',
  'มัด',
  'ชุด',
  'หลอด',
  'แผง',
  'ซอง',
  'กระป๋อง',
  'ลัง',
];

export const DEFAULT_USAGE_UNITS: string[] = [
  'g',
  'kg',
  'ตัว',
  'ฟอง',
  'ml',
  'L',
  'ชิ้น',
  'จาน',
  'แพ็ค',
  'ขวด',
  'กล่อง',
  'ถุง',
  'มัด',
  'ชุด',
  'ซอง',
];

const UNIT_LABELS_TH: Record<string, string> = {
  g: 'g (กรัม)',
  kg: 'kg (กิโลกรัม)',
  ml: 'ml (มิลลิลิตร)',
  L: 'L (ลิตร)',
  l: 'l (ลิตร)',
  ตัว: 'ตัว (คิดเป็นตัว เช่น กุ้ง)',
  ฟอง: 'ฟอง (ไข่ไก่)',
};

const UNIT_LABELS_EN: Record<string, string> = {
  g: 'g (Gram)',
  kg: 'kg (Kilogram)',
  ml: 'ml (Milliliter)',
  L: 'L (Liter)',
  l: 'l (Liter)',
  ตัว: 'pc (Counted item e.g. Shrimp)',
  ฟอง: 'egg (Egg)',
};

export function mergeUniqueUnits(
  ...lists: Array<Array<string | undefined | null> | undefined>
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const raw of list) {
      const trimmed = (raw || '').trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export function loadCustomPurchaseUnits(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CUSTOM_PURCHASE_UNITS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return mergeUniqueUnits(parsed.map((x) => (typeof x === 'string' ? x : '')));
  } catch {
    return [];
  }
}

export function saveCustomPurchaseUnits(units: string[]): string[] {
  const cleaned = mergeUniqueUnits(units);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_PURCHASE_UNITS_STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch {}
  return cleaned;
}

export function syncUnitToPortionUnitsStorage(unit: string): void {
  const trimmed = (unit || '').trim();
  if (!trimmed) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem(CUSTOM_PORTION_UNITS_STORAGE_KEY);
    const current: string[] = saved ? JSON.parse(saved) : [];
    if (Array.isArray(current) && !current.includes(trimmed)) {
      localStorage.setItem(
        CUSTOM_PORTION_UNITS_STORAGE_KEY,
        JSON.stringify([...current, trimmed])
      );
    }
  } catch {}
}

export function getUnitOptionLabel(unit: string, lang: 'th' | 'en'): string {
  if (lang === 'en') {
    return UNIT_LABELS_EN[unit] || localizeUnit(unit, 'en') || unit;
  }
  return UNIT_LABELS_TH[unit] || unit;
}
