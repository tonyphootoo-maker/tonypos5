/**
 * Pure Unit Conversion Engine
 * Supports standard mass, volume, and unit count conversions with strict validation.
 */

import { UnitType } from '../types/domain';

// Standard base conversions
const MASS_TO_GRAM: Record<string, number> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  tbsp: 15,
  tsp: 5,
  cup: 240,
};

const COUNT_UNITS = new Set([
  'piece',
  'pack',
  'bottle',
  'box',
  'can',
  'bag',
  'egg',
  'portion',
  'serving',
  'custom',
]);

export interface ConversionResult {
  success: boolean;
  convertedQuantity: number;
  errorMessageTh?: string;
  errorMessageEn?: string;
}

/**
 * Convert quantity from one unit to another
 * @param quantity Amount to convert
 * @param fromUnit Starting unit
 * @param toUnit Target unit
 * @param density Grams per milliliter (optional, defaults to 1.0 for aqueous liquids)
 * @param piecesPerPack Custom count factor if converting between packaging units
 */
export function convertUnit(
  quantity: number,
  fromUnit: UnitType,
  toUnit: UnitType,
  density?: number,
  customMultiplier: number = 1.0
): ConversionResult {
  if (quantity < 0 || isNaN(quantity)) {
    return {
      success: false,
      convertedQuantity: 0,
      errorMessageTh: 'จำนวนไม่ถูกต้อง (ต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0)',
      errorMessageEn: 'Invalid quantity (must be a positive number)',
    };
  }

  // Same unit
  if (fromUnit === toUnit) {
    return {
      success: true,
      convertedQuantity: quantity,
    };
  }

  // Mass to Mass
  if (MASS_TO_GRAM[fromUnit] && MASS_TO_GRAM[toUnit]) {
    const inGrams = quantity * MASS_TO_GRAM[fromUnit];
    const target = inGrams / MASS_TO_GRAM[toUnit];
    return {
      success: true,
      convertedQuantity: target,
    };
  }

  // Volume to Volume
  if (VOLUME_TO_ML[fromUnit] && VOLUME_TO_ML[toUnit]) {
    const inMl = quantity * VOLUME_TO_ML[fromUnit];
    const target = inMl / VOLUME_TO_ML[toUnit];
    return {
      success: true,
      convertedQuantity: target,
    };
  }

  // Mass to Volume (using density: g / density = ml)
  if (MASS_TO_GRAM[fromUnit] && VOLUME_TO_ML[toUnit]) {
    if (density === undefined || density === null || density <= 0) {
      return {
        success: false,
        convertedQuantity: 0,
        errorMessageTh: `ต้องระบุความหนาแน่นเพื่อแปลง ${fromUnit} เป็น ${toUnit}`,
        errorMessageEn: `Density is required to convert from ${fromUnit} to ${toUnit}`,
      };
    }
    const inGrams = quantity * MASS_TO_GRAM[fromUnit];
    const inMl = inGrams / density;
    const target = inMl / VOLUME_TO_ML[toUnit];
    return {
      success: true,
      convertedQuantity: target,
    };
  }

  // Volume to Mass (using density: ml * density = g)
  if (VOLUME_TO_ML[fromUnit] && MASS_TO_GRAM[toUnit]) {
    if (density === undefined || density === null || density <= 0) {
      return {
        success: false,
        convertedQuantity: 0,
        errorMessageTh: `ต้องระบุความหนาแน่นเพื่อแปลง ${fromUnit} เป็น ${toUnit}`,
        errorMessageEn: `Density is required to convert from ${fromUnit} to ${toUnit}`,
      };
    }
    const inMl = quantity * VOLUME_TO_ML[fromUnit];
    const inGrams = inMl * density;
    const target = inGrams / MASS_TO_GRAM[toUnit];
    return {
      success: true,
      convertedQuantity: target,
    };
  }

  // Custom unit conversions (e.g. pack to piece)
  if (customMultiplier && customMultiplier !== 1) {
    return {
      success: true,
      convertedQuantity: quantity * customMultiplier,
    };
  }

  // Incompatible units
  return {
    success: false,
    convertedQuantity: 0,
    errorMessageTh: `ไม่สามารถแปลงหน่วยจาก "${fromUnit}" ไปเป็น "${toUnit}" ได้โดยตรง (หน่วยคนละประเภท)`,
    errorMessageEn: `Cannot convert directly from "${fromUnit}" to "${toUnit}" (incompatible unit types)`,
  };
}

/**
 * Format unit for display with bilingual labels
 */
export function formatUnitLabel(unit: UnitType, lang: 'th' | 'en' = 'th'): string {
  const map: Record<UnitType, { th: string; en: string }> = {
    g: { th: 'กรัม (g)', en: 'Grams (g)' },
    kg: { th: 'กิโลกรัม (kg)', en: 'Kilograms (kg)' },
    mg: { th: 'มิลลิกรัม (mg)', en: 'Milligrams (mg)' },
    ml: { th: 'มิลลิลิตร (ml)', en: 'Milliliters (ml)' },
    l: { th: 'ลิตร (L)', en: 'Liters (L)' },
    tbsp: { th: 'ช้อนโต๊ะ (tbsp)', en: 'Tablespoon (tbsp)' },
    tsp: { th: 'ช้อนชา (tsp)', en: 'Teaspoon (tsp)' },
    cup: { th: 'ถ้วยตวง (cup)', en: 'Cup' },
    piece: { th: 'ชิ้น / หัว / ฟอง', en: 'Piece' },
    pack: { th: 'แพ็ค / ห่อ', en: 'Pack' },
    bottle: { th: 'ขวด', en: 'Bottle' },
    box: { th: 'กล่อง', en: 'Box' },
    can: { th: 'กระป๋อง', en: 'Can' },
    bag: { th: 'ถุง', en: 'Bag' },
    egg: { th: 'ฟอง', en: 'Egg' },
    portion: { th: 'ที่ / พอร์ชั่น', en: 'Portion' },
    serving: { th: 'เสิร์ฟ', en: 'Serving' },
    custom: { th: 'หน่วยกำหนดเอง', en: 'Custom' },
  };

  return map[unit] ? map[unit][lang] : unit;
}
