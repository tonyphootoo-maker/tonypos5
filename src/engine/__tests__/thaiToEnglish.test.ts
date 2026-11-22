import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  translateThaiToEnglish,
  translateMenuName,
  resolveMenuNameSync,
  resolveEntityEnglishName,
  normalizeThaiForTranslation,
  computeAutoEnglishName,
  getShopTranslationGlossary,
  setShopTranslationGlossary,
  clearShopTranslationGlossary,
} from '../../utils/thaiToEnglish';
import {
  createDebouncedTranslationScheduler,
  needsEnglishReview,
} from '../../hooks/useDebouncedThaiTranslation';
import { buildRetranslatePreview } from '../../utils/retranslateScanner';
import { resolveCostVariantDisplayNames } from '../../costing/services/spreadsheetCostHelper';
import {
  convertUnit,
  isPieceLikeUnit,
  normalizeUnitToken,
} from '../../costing/engine/units';
import { calculateIngredientCost } from '../../costing/services/calculationEngine';
import { convertUnitQuantity } from '../../costing/services/transactionService';
import { mergeUniqueUnits } from '../../costing/utils/customUnits';

describe('thaiToEnglish culinary translation & auto-sync (Phase 1)', () => {
  beforeEach(() => {
    clearShopTranslationGlossary();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearShopTranslationGlossary();
  });

  it('produces exact required culinary English for all 28 core restaurant items', () => {
    const requiredCases: Array<[string, string]> = [
      ['ปอเปี๊ยะผัก', 'Vegetable Spring Rolls'],
      ['ปอเปี๊ยะไส้ผัก', 'Vegetable Spring Rolls'],
      ['เปาะเปี๊ยะผัก', 'Vegetable Spring Rolls'],
      ['ปอเปี๊ยะทอด', 'Fried Spring Rolls'],
      ['ปอเปี๊ยะสด', 'Fresh Spring Rolls'],
      ['ปอเปี๊ยะกุ้งสด', 'Fresh Shrimp Spring Rolls'],
      ['กุ้งทอด', 'Fried Shrimp'],
      ['ไก่ทอด', 'Fried Chicken'],
      ['ปลาทอด', 'Fried Fish'],
      ['ผักรวม', 'Mixed Vegetables'],
      ['ผัดผักรวม', 'Stir-Fried Mixed Vegetables'],
      ['ทอดมันปลา', 'Thai Fish Cakes (Tod Mun Pla)'],
      ['ทอดมันกุ้ง', 'Thai Shrimp Cakes (Tod Mun Kung)'],
      ['น้ำจิ้ม', 'Dipping Sauce'],
      ['น้ำจิ้มไก่', 'Sweet Chili Dipping Sauce'],
      ['น้ำจิ้มซีฟู้ด', 'Seafood Spicy Dipping Sauce'],
      ['ชาเย็น', 'Thai Iced Tea'],
      ['ชาไทยเย็น', 'Thai Iced Tea'],
      ['ขนมจีบ', 'Steamed Dumplings (Kanom Jeeb)'],
      ['ซาลาเปา', 'Steamed Buns'],
      ['เกี๊ยวทอด', 'Fried Wontons'],
      ['หมูปิ้ง', 'Grilled Pork Skewers (Moo Ping)'],
      ['คอหมูย่าง', 'Grilled Pork Neck'],
      ['ส้มตำไทย', 'Thai Papaya Salad'],
      ['ลาบหมู', 'Spicy Minced Pork Salad (Larb)'],
      ['ต้มยำกุ้ง', 'Tom Yum Kung'],
      ['ข้าวมันไก่', 'Hainanese Chicken Rice'],
      ['ข้าวผัดปู', 'Crab Fried Rice'],
    ];

    for (const [th, expectedEn] of requiredCases) {
      expect(translateThaiToEnglish(th)).toBe(expectedEn);
      const meta = resolveMenuNameSync(th);
      expect(meta.en).toBe(expectedEn);
      expect(meta.needsReview).toBe(false);
    }
  });

  it('translates Thai dishes, sauces, drinks, and categories into English (Rule B regressions)', () => {
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
    expect(translateThaiToEnglish('ชาไทยเย็น')).toBe('Thai Iced Tea');
    expect(translateThaiToEnglish('เนื้อสัตว์และอาหารทะเล')).toBe(
      'Meats & Seafood'
    );
    expect(translateThaiToEnglish('สันคอหมู')).toBe('Pork Collar');
    expect(translateThaiToEnglish('น้ำปลาร้า')).toBe('Fermented Fish Sauce');
    expect(translateThaiToEnglish('ยำหมูย่าง')).toBe('Spicy Grilled Pork Salad');
    expect(translateThaiToEnglish('แกงเขียวหวานกุ้ง')).toBe('Green Curry with Shrimp');
    expect(translateThaiToEnglish('กุ้งทอดกระเทียม')).toBe('Fried Garlic Shrimp');
    expect(translateThaiToEnglish('ซอสสามรส')).toBe('Three-Flavor Sweet & Sour Sauce');
    expect(translateThaiToEnglish('ใบมะกรูด')).not.toMatch(/Kaphrao|Namman|Phrik|Bai/i);
    expect(translateThaiToEnglish('ใบมะกรูด')).toBe('Kaffir Lime Leaves');
    expect(translateThaiToEnglish('ไข่ดาว')).toBe('Fried Egg');
    expect(translateThaiToEnglish('เผ็ดน้อย')).toBe('Mild Spicy');
    expect(translateThaiToEnglish('หมูสับ')).toBe('Minced Pork');
  });

  it('never emits partial translations or karaoke romanization on unknown words (Rule A)', async () => {
    const unknownCases = [
      'เมนูซิกเนเจอร์ลึกลับ',
      'ปอเปี๊ยะโฮมเมดสูตรพิเศษลับ',
      'ซอสพิเศษสูตรคุณยาย',
    ];

    for (const input of unknownCases) {
      expect(translateThaiToEnglish(input)).toBe('');
      const syncRes = resolveMenuNameSync(input);
      expect(syncRes).toEqual({
        en: '',
        source: 'none',
        confidence: 'low',
        needsReview: true,
      });
      const asyncRes = await translateMenuName(input);
      expect(asyncRes.en).toBe('');
      expect(asyncRes.needsReview).toBe(true);
    }
  });

  it('normalizes zero-width chars, Sara Am, variants, and preserves ASCII suffixes (R3)', () => {
    expect(normalizeThaiForTranslation('\u200B  เปาะเปี๊ยะผัก  ')).toBe('ปอเปี๊ยะผัก');
    expect(normalizeThaiForTranslation('กระเพราหมูสับ')).toBe('กะเพราหมูสับ');
    // Decomposed Sara Am: น + tone ้ + ํ + า
    expect(translateThaiToEnglish('น\u0E49\u0E4D\u0E32จิ้ม')).toBe('Dipping Sauce');
    expect(translateThaiToEnglish('ข้าวผัดปู XL')).toBe('Crab Fried Rice XL');
    expect(translateThaiToEnglish('ต้มยำกุ้ง (2)')).toBe('Tom Yum Kung (2)');
    expect(translateThaiToEnglish('อื่นๆ')).toBe('Other');
    expect(translateThaiToEnglish('อื่น ๆ')).toBe('Other');

    // Glossary override takes priority over built-in dictionary
    setShopTranslationGlossary({ ชาเย็น: 'Cha Yen Signature' });
    expect(getShopTranslationGlossary()['ชาเย็น']).toBe('Cha Yen Signature');
    expect(translateThaiToEnglish('ชาเย็น')).toBe('Cha Yen Signature');
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

  it('debounces auto-translation by 600ms and supports blur/save flush & cancel (R6)', () => {
    vi.useFakeTimers();
    const scheduler = createDebouncedTranslationScheduler(600);
    const spy = vi.fn();

    scheduler.schedule('dish', spy);
    vi.advanceTimersByTime(599);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);

    // Flush executes pending callback immediately and avoids double fire
    const blurSpy = vi.fn();
    scheduler.schedule('dish', blurSpy);
    expect(scheduler.hasPending('dish')).toBe(true);
    scheduler.flush('dish');
    expect(blurSpy).toHaveBeenCalledTimes(1);
    expect(scheduler.hasPending('dish')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(blurSpy).toHaveBeenCalledTimes(1);

    // Cancel aborts pending timer
    const cancelSpy = vi.fn();
    scheduler.schedule('dish', cancelSpy);
    scheduler.cancel('dish');
    vi.advanceTimersByTime(1000);
    expect(cancelSpy).not.toHaveBeenCalled();

    expect(needsEnglishReview('เมนูแปลไม่ได้', '')).toBe(true);
    expect(needsEnglishReview('เมนูแปลไม่ได้', 'เมนูแปลไม่ได้')).toBe(true);
    expect(needsEnglishReview('ปอเปี๊ยะผัก', 'Vegetable Spring Rolls')).toBe(false);
  });

  it('resolves stored English consistently and skips manual names in batch re-translation (R7)', () => {
    expect(resolveEntityEnglishName('ปอเปี๊ยะผัก', 'House Veggie Rolls')).toBe(
      'House Veggie Rolls'
    );
    expect(resolveEntityEnglishName('ปอเปี๊ยะผัก', '')).toBe('Vegetable Spring Rolls');
    expect(resolveEntityEnglishName('ปอเปี๊ยะผัก', 'ปอเปี๊ยะผัก')).toBe(
      'Vegetable Spring Rolls'
    );
    expect(resolveEntityEnglishName('เมนูแปลไม่ได้ไม่รู้จัก', '')).toBe('');

    const sampleCostMenus = [
      {
        id: 'cm1',
        name: 'ทอดมันปลา',
        englishName: 'Thai Fish Cakes (Tod Mun Pla)',
        category: 'อาหารทานเล่น',
        variants: [
          {
            id: 'cv1',
            menuId: 'cm1',
            name: 'ทอดมันปลา',
            proteinType: 'ปลา',
            englishName: 'Custom Fish Cakes',
            recipeItems: [],
            sellingPrice: 120,
            takeawayPrice: 120,
            deliveryPrice: 150,
            overheadCost: 0,
            active: true,
          },
        ],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ];

    const costVariantDisplay = resolveCostVariantDisplayNames(
      {
        id: 'd1',
        nameTh: 'ทอดมันปลา',
        name: 'Thai Fish Cakes (Tod Mun Pla)',
        costMenuId: 'cm1',
      },
      {
        id: 'cv1',
        costMenuId: 'cm1',
        costVariantId: 'cv1',
        nameTh: 'ปลา',
        name: 'Old Variant',
      },
      sampleCostMenus
    );
    expect(costVariantDisplay.name).toBe('Custom Fish Cakes');
    expect(costVariantDisplay.nameTh).toBe('ทอดมันปลา');

    const preview = buildRetranslatePreview({
      dishes: [
        {
          id: 'd_auto',
          nameTh: 'ปอเปี๊ยะผัก',
          name: 'Ppeiyaphak',
          nameEnManual: false,
          categoryId: 'c1',
          variants: [],
          optionGroupIds: [],
          order: 1,
          createdAt: '',
          updatedAt: '',
          version: 1,
        },
        {
          id: 'd_manual',
          nameTh: 'ปอเปี๊ยะผัก',
          name: 'Chef Crispy Veggie Rolls',
          nameEnManual: true,
          categoryId: 'c1',
          variants: [],
          optionGroupIds: [],
          order: 2,
          createdAt: '',
          updatedAt: '',
          version: 1,
        },
        {
          id: 'd_unresolved',
          nameTh: 'เมนูแปลไม่ได้ลึกลับ',
          name: '',
          nameEnManual: false,
          categoryId: 'c1',
          variants: [],
          optionGroupIds: [],
          order: 3,
          createdAt: '',
          updatedAt: '',
          version: 1,
        },
      ],
      costMenus: [
        {
          id: 'cm1',
          name: 'ทอดมันปลา',
          englishName: 'Fried Rich Fish',
          category: 'อาหารทานเล่น',
          variants: [
            {
              id: 'cv1',
              menuId: 'cm1',
              name: 'ทอดมันปลา (จาน)',
              proteinType: 'ปลา',
              englishName: 'Fish',
              recipeItems: [],
              sellingPrice: 120,
              takeawayPrice: 120,
              deliveryPrice: 150,
              overheadCost: 0,
              active: true,
            },
          ],
          active: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });

    expect(preview.skippedManualCount).toBe(1);
    expect(preview.unresolvedCount).toBe(1);
    expect(preview.items).toHaveLength(3);
    expect(preview.items.find((i) => i.id === 'd_auto')?.newEnglish).toBe(
      'Vegetable Spring Rolls'
    );
    expect(preview.items.find((i) => i.id === 'cm1')?.newEnglish).toBe(
      'Thai Fish Cakes (Tod Mun Pla)'
    );
    expect(preview.items.find((i) => i.id === 'cv1')?.newEnglish).toBe(
      'Thai Fish Cakes (Tod Mun Pla) (Plate)'
    );
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

  it('supports user-added custom purchase units in costing, conversion, and unit merging', () => {
    expect(isPieceLikeUnit('แกลลอน')).toBe(true);
    expect(isPieceLikeUnit('กระสอบ')).toBe(true);

    // Direct same-unit custom purchase unit calculation
    const gallonCost = calculateIngredientCost({
      name: 'น้ำมันพืชแกลลอน',
      purchaseQuantity: 1,
      purchaseUnit: 'แกลลอน',
      purchasePrice: 280,
      usageUnit: 'แกลลอน',
      yieldPercent: 100,
    });
    expect(gallonCost.isValid).toBe(true);
    expect(gallonCost.costPerBaseUnit).toBeCloseTo(280, 6);

    // Multi-unit custom purchase unit with sub-unit count (1 ลัง = 24 ขวด)
    const crateCost = calculateIngredientCost({
      name: 'ซอสปรุงรส',
      purchaseQuantity: 1,
      purchaseUnit: 'ลัง',
      piecesPerPurchaseUnit: 24,
      purchasePrice: 480,
      usageUnit: 'ขวด',
      yieldPercent: 100,
    });
    expect(crateCost.isValid).toBe(true);
    expect(crateCost.costPerBaseUnit).toBeCloseTo(20, 6);

    // Case-insensitive L/ml and custom unit quantity conversion
    expect(convertUnitQuantity(2, 'L', 'ml')).toBe(2000);
    expect(convertUnitQuantity(5, 'แกลลอน', 'แกลลอน')).toBe(5);

    // Deduplicated custom unit merging
    expect(mergeUniqueUnits(['g', 'kg'], ['แกลลอน', 'g', ' ลัง '])).toEqual([
      'g',
      'kg',
      'แกลลอน',
      'ลัง',
    ]);
  });
});
