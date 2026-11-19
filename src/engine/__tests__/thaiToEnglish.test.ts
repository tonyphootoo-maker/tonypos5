import { describe, it, expect } from 'vitest';
import {
  translateThaiToEnglish,
  computeAutoEnglishName,
} from '../../utils/thaiToEnglish';
import {
  convertUnit,
  isPieceLikeUnit,
  normalizeUnitToken,
} from '../../costing/engine/units';

describe('thaiToEnglish culinary translation & auto-sync', () => {
  it('translates Thai dishes, sauces, drinks, and categories into English', () => {
    expect(translateThaiToEnglish('ผัดกะเพราหมูกรอบ')).toBe(
      'Stir-Fried Holy Basil with Crispy Pork'
    );
    expect(translateThaiToEnglish('ไข่เจียวปู')).toBe('Crab Omelette');
    expect(translateThaiToEnglish('ข้าวไข่ข้น')).toBe('Creamy Omelette on Rice');
    expect(translateThaiToEnglish('ก๋วยเตี๋ยวคั่วไก่')).toBe(
      'Stir-Fried Rice Noodles with Chicken'
    );
    expect(translateThaiToEnglish('ปลากะพงทอดน้ำปลา')).toBe(
      'Deep-Fried Sea Bass with Fish Sauce'
    );
    expect(translateThaiToEnglish('ชาไทยเย็น')).toBe('Iced Thai Tea');
    expect(translateThaiToEnglish('เนื้อสัตว์และอาหารทะเล')).toBe(
      'Meats & Seafood'
    );
  });

  it('auto-updates English name while Thai name changes unless manually overridden', () => {
    const firstEn = computeAutoEnglishName({
      previousThai: '',
      nextThai: 'ข้าวผัดปู',
      currentEnglish: '',
      isManuallyEdited: false,
    });
    expect(firstEn).toBe('Crab Fried Rice');

    const updatedEn = computeAutoEnglishName({
      previousThai: 'ข้าวผัดปู',
      nextThai: 'ข้าวผัดกุ้ง',
      currentEnglish: firstEn,
      isManuallyEdited: false,
    });
    expect(updatedEn).toBe('Shrimp Fried Rice');

    const manualEn = computeAutoEnglishName({
      previousThai: 'ข้าวผัดกุ้ง',
      nextThai: 'ข้าวผัดทะเล',
      currentEnglish: 'Chef Special Shrimp Rice',
      isManuallyEdited: true,
    });
    expect(manualEn).toBe('Chef Special Shrimp Rice');
  });
});

describe('portion unit normalization & conversion', () => {
  it('normalizes Thai and English piece-like and custom units cleanly', () => {
    expect(normalizeUnitToken('ชิ้น')).toBe('piece');
    expect(normalizeUnitToken('กรัม')).toBe('g');
    expect(isPieceLikeUnit('ฟอง')).toBe(true);
    expect(isPieceLikeUnit('ชิ้น')).toBe(true);
    expect(isPieceLikeUnit('ถุง')).toBe(true);
    expect(isPieceLikeUnit('g')).toBe(false);
  });

  it('converts compatible mass/volume units and same custom unit tokens', () => {
    const kgToG = convertUnit(0.15, 'kg', 'g');
    expect(kgToG.success).toBe(true);
    expect(kgToG.convertedQuantity).toBeCloseTo(150);

    const gToKg = convertUnit(120, 'g', 'kg');
    expect(gToKg.success).toBe(true);
    expect(gToKg.convertedQuantity).toBeCloseTo(0.12);

    const pieceAlias = convertUnit(2, 'ชิ้น', 'piece');
    expect(pieceAlias.success).toBe(true);
    expect(pieceAlias.convertedQuantity).toBe(2);

    const sameCustom = convertUnit(1, 'ไม้', 'ไม้');
    expect(sameCustom.success).toBe(true);
    expect(sameCustom.convertedQuantity).toBe(1);
  });
});
