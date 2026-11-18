import { describe, it, expect } from 'vitest';
import {
  calculateWeightedFoodCostPercent,
  extractNetPriceFromMenuPrice,
  calculateBillFinancials,
  roundUpToStep,
} from '../calculations';
import {
  calculateIngredientItemCost,
  calculateBillTotal,
} from '../../costing/engine/calculations';
import { convertUnit, normalizeUnitToken } from '../../costing/engine/units';
import {
  calculateIngredientCost,
  calculateSauceCost,
  calculateVariantCostBreakdown,
  calculateChannelSuggestedPrices,
  getEffectiveDeliveryGpPercent,
  runFullSpecificationTests,
  runSection11SpecificationTests,
} from '../../costing/services/calculationEngine';
import { Ingredient, MenuVariant, RestaurantSettings, Sauce } from '../../costing/types';

function makeSettings(overrides: Partial<RestaurantSettings> = {}): RestaurantSettings {
  return {
    restaurantName: 'Test Kitchen',
    defaultOverheadCostPerDish: 0,
    targetFoodCostPercent: 40,
    targetProfitAmount: 25,
    takeawayPackagingCost: 5,
    deliveryPackagingCost: 8,
    grabFoodCommissionPercent: 30,
    grabFoodCommissionHasVat: true,
    lineManCommissionPercent: 25,
    lineManCommissionHasVat: true,
    commissionVatAsCost: true,
    vatRatePercent: 7,
    pricesIncludeVat: false,
    salesVatInclusive: false,
    serviceChargeIncludedInPrice: false,
    serviceChargePercent: 0,
    priceRounding: 1,
    defaultTicketSize: 140,
    channels: [],
    userRole: 'OWNER',
    ...overrides,
  };
}

describe('Menu Costing, Sauce Validation, Units, Pricing, Delivery GP+VAT & Sales Weighting', () => {
  describe('1. Sauce / Prepared Batch Costing & Invalid Output Guard', () => {
    it('calculates sauce costPerGram accurately (120 THB / 600 g = 0.20 THB/g) and rejects 0 / undefined / NaN net quantity', () => {
      const garlic: Ingredient = {
        id: 'ing_garlic',
        name: 'กระเทียม',
        category: 'เครื่องปรุงและซอส',
        purchaseQuantity: 1000,
        purchaseUnit: 'g',
        purchasePrice: 120,
        actualQuantity: 1000,
        actualUnit: 'g',
        yieldPercent: 100,
        actualCost: 120,
        baseUnit: 'g',
        costPerBaseUnit: 0.12,
        usageUnit: 'g',
        active: true,
        createdAt: '',
        updatedAt: '',
      };
      const ingMap = new Map<string, Ingredient>([['ing_garlic', garlic]]);

      const validSauce: Sauce = {
        id: 'sauce_pad',
        name: 'ซอสผัดอเนกประสงค์',
        productionQuantity: 600,
        productionUnit: 'g',
        actualQuantity: 600,
        yieldPercent: 100,
        productionCost: 120,
        actualCost: 120,
        costPerGram: 0.2,
        active: true,
        createdAt: '',
        updatedAt: '',
        items: [
          {
            ingredientId: 'ing_garlic',
            ingredientName: 'กระเทียม',
            quantity: 1,
            unit: 'กก.' as any, // 1 kg = 1,000 g -> 120 THB (tests Thai unit token alias normalization)
            unitCost: 0.12,
            lineCost: 120,
          },
        ],
      };

      const validRes = calculateSauceCost(validSauce, ingMap);
      expect(validRes.isValid).toBe(true);
      expect(validRes.productionCost).toBeCloseTo(120, 4);
      expect(validRes.costPerGram).toBeCloseTo(0.2, 6);

      for (const badQty of [0, undefined as unknown as number, Number.NaN, -50]) {
        const invalidRes = calculateSauceCost({ ...validSauce, actualQuantity: badQty }, ingMap);
        expect(invalidRes.isValid).toBe(false);
        expect(invalidRes.costPerGram).toBe(0);
        expect(invalidRes.errorMessage).toContain('กรุณาระบุปริมาณสุทธิของซอส');
      }
    });
  });

  describe('2. Multi-Unit Pieces, Yield Guard & Thai/English Unit Conversion', () => {
    it('computes 2 trays x 30 eggs = 60 eggs at 240 THB -> 4 THB/egg (both engines)', () => {
      const itemCalc = calculateIngredientItemCost({
        purchasePrice: 240,
        purchaseQuantity: 2,
        purchaseUnit: 'แผง',
        piecesPerPurchaseUnit: 30,
        usageQuantity: 2,
        usageUnit: 'ฟอง',
      });
      expect(itemCalc.isValid).toBe(true);
      expect(itemCalc.unitCost).toBeCloseTo(4, 6);
      expect(itemCalc.lineCost).toBeCloseTo(8, 6);

      const ingCalc = calculateIngredientCost({
        name: 'ไข่ไก่',
        purchaseQuantity: 2,
        purchaseUnit: 'แผง' as any,
        piecesPerPurchaseUnit: 30,
        purchasePrice: 240,
        usageUnit: 'ฟอง',
        baseUnit: 'ฟอง',
        yieldPercent: 100,
      });
      expect(ingCalc.isValid).toBe(true);
      expect(ingCalc.costPerBaseUnit).toBeCloseTo(4, 6);
    });

    it('respects piecesCountAlreadyYieldAdjusted to prevent double yield reduction', () => {
      // 60 peeled shrimps per pack @ 510 THB; 70% trim yield only reduces if NOT already yield-adjusted
      const unadjusted = calculateIngredientCost({
        name: 'กุ้งสด',
        purchaseQuantity: 1,
        purchaseUnit: 'แพ็ค',
        piecesPerPurchaseUnit: 60,
        purchasePrice: 510,
        usageUnit: 'ตัว',
        yieldPercent: 70,
        piecesCountAlreadyYieldAdjusted: false,
      });
      expect(unadjusted.isValid).toBe(true);
      expect(unadjusted.costPerBaseUnit).toBeCloseTo(510 / (60 * 0.7), 6);

      const alreadyAdjusted = calculateIngredientCost({
        name: 'กุ้งแกะเปลือก',
        purchaseQuantity: 60,
        purchaseUnit: 'ตัว',
        piecesPerPurchaseUnit: 60,
        purchasePrice: 510,
        usageUnit: 'ตัว',
        yieldPercent: 70,
        piecesCountAlreadyYieldAdjusted: true,
      });
      expect(alreadyAdjusted.isValid).toBe(true);
      expect(alreadyAdjusted.costPerBaseUnit).toBeCloseTo(510 / 60, 6);
    });

    it('normalizes Thai/English unit aliases and rejects incompatible mass vs volume conversions', () => {
      expect(normalizeUnitToken('กก.')).toBe('kg');
      expect(normalizeUnitToken('กรัม')).toBe('g');
      expect(normalizeUnitToken('มล.')).toBe('ml');
      expect(normalizeUnitToken('egg')).toBe('ฟอง');
      expect(normalizeUnitToken('ฟอง')).toBe('ฟอง');

      const kgToG = convertUnit(1.5, 'กก.', 'กรัม');
      expect(kgToG.success).toBe(true);
      expect(kgToG.convertedQuantity).toBeCloseTo(1500, 6);

      const gToMlNoDensity = convertUnit(100, 'g', 'ml');
      expect(gToMlNoDensity.success).toBe(false);

      const gToMlWithDensity = convertUnit(100, 'g', 'ml', 1.25);
      expect(gToMlWithDensity.success).toBe(true);
      expect(gToMlWithDensity.convertedQuantity).toBeCloseTo(80, 6);
    });
  });

  describe('3. VAT-Inclusive Denominator, Dine-In No Packaging, & Uncapped Loss', () => {
    it('extracts VAT before computing Food Cost %, excludes packaging on dine-in, and preserves negative profit', () => {
      const pork: Ingredient = {
        id: 'ing_pork',
        name: 'หมูสับ',
        category: 'เนื้อสัตว์และอาหารทะเล',
        purchaseQuantity: 1000,
        purchaseUnit: 'g',
        purchasePrice: 300,
        actualQuantity: 1000,
        actualUnit: 'g',
        yieldPercent: 100,
        actualCost: 300,
        baseUnit: 'g',
        costPerBaseUnit: 0.3,
        usageUnit: 'g',
        active: true,
        createdAt: '',
        updatedAt: '',
      };
      const ingMap = new Map<string, Ingredient>([['ing_pork', pork]]);

      const variant: MenuVariant = {
        id: 'var_vat_test',
        menuId: 'menu_vat',
        name: 'จานปกติ',
        proteinType: 'หมูสับ',
        sellingPrice: 107,
        takeawayPrice: 107,
        deliveryPrice: 150,
        overheadCost: 0,
        taxType: 'INCLUSIVE',
        packagingCost: 8,
        active: true,
        recipeItems: [
          {
            id: 'ri-1',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_pork',
            name: 'หมูสับ',
            quantity: 100, // 30 THB direct food cost
            unit: 'g',
            calculatedUnitCost: 0.3,
            calculatedLineCost: 30,
          },
        ],
      };

      const settings = makeSettings({
        vatRatePercent: 7,
        pricesIncludeVat: true,
        defaultOverheadCostPerDish: 0,
      });

      const bd = calculateVariantCostBreakdown(variant, 'กะเพรา', ingMap, new Map(), settings);
      expect(bd.netDineInSellingPrice).toBeCloseTo(100, 4);
      expect(bd.totalIngredientCost).toBeCloseTo(30, 4);
      expect(bd.totalCost).toBeCloseTo(30, 4); // No takeaway packaging included in dine-in totalCost
      expect(bd.restaurantFoodCostPercent).toBeCloseTo(30, 4);
      expect(bd.restaurantProfit).toBeCloseTo(70, 4);

      // Loss-making dish: sellingPrice 21.40 incl VAT -> net 20, foodCost 30 -> profit -10 (NOT clamped to 0)
      const lossBd = calculateVariantCostBreakdown(
        { ...variant, sellingPrice: 21.4 },
        'เมนูลดพิเศษ',
        ingMap,
        new Map(),
        settings
      );
      expect(lossBd.netDineInSellingPrice).toBeCloseTo(20, 4);
      expect(lossBd.restaurantProfit).toBeCloseTo(-10, 4);
      expect(lossBd.restaurantProfit).toBeLessThan(0);
    });
  });

  describe('4. Delivery GP + VAT & Price Step-Up Rounding', () => {
    it('computes effective GP 32.1% when commissionVatAsCost=true (30% * 1.07) vs 30% when false, and rounds up by 1 / 5 / 10', () => {
      const settingsWithVat = makeSettings({
        grabFoodCommissionPercent: 30,
        commissionVatAsCost: true,
        vatRatePercent: 7,
      });
      const settingsNoVat = makeSettings({
        grabFoodCommissionPercent: 30,
        commissionVatAsCost: false,
        grabFoodCommissionHasVat: false,
        vatRatePercent: 7,
      });

      expect(getEffectiveDeliveryGpPercent(settingsWithVat, 'grab')).toBeCloseTo(32.1, 4);
      expect(getEffectiveDeliveryGpPercent(settingsNoVat, 'grab')).toBeCloseTo(30.0, 4);

      // Net target = 100 THB (40 food / 40% target FC), 0 pkg, GP 30% + 7% VAT => effective GP = 32.1%
      // Exact gross delivery price = 100 / (1 - 0.321) = 147.2754...
      const step1 = calculateChannelSuggestedPrices(40, 40, 20, 0, 30, 0, {
        commissionHasVat: true,
        vatRatePercent: 7,
        roundingStep: 1,
      });
      expect(step1.effectiveDeliveryGpPercent).toBeCloseTo(32.1, 4);
      expect(step1.suggestedDeliveryPriceByFc).toBe(148);

      const step5 = calculateChannelSuggestedPrices(40, 40, 20, 0, 30, 0, {
        commissionHasVat: true,
        vatRatePercent: 7,
        roundingStep: 5,
      });
      expect(step5.suggestedDeliveryPriceByFc).toBe(150);

      const step10 = calculateChannelSuggestedPrices(40, 40, 20, 0, 30, 0, {
        commissionHasVat: true,
        vatRatePercent: 7,
        roundingStep: 10,
      });
      expect(step10.suggestedDeliveryPriceByFc).toBe(150);
    });
  });

  describe('5. Non-Circular SELLING_PRICE Overhead Algebraic Pricing', () => {
    it('solves P = (foodCost + targetProfit) / (1 - overheadRate) independently of current variant.sellingPrice', () => {
      const ing: Ingredient = {
        id: 'ing_chx',
        name: 'อกไก่',
        category: 'เนื้อสัตว์และอาหารทะเล',
        purchaseQuantity: 1000,
        purchaseUnit: 'g',
        purchasePrice: 400,
        actualQuantity: 1000,
        actualUnit: 'g',
        yieldPercent: 100,
        actualCost: 400,
        baseUnit: 'g',
        costPerBaseUnit: 0.4,
        usageUnit: 'g',
        active: true,
        createdAt: '',
        updatedAt: '',
      };
      const ingMap = new Map<string, Ingredient>([['ing_chx', ing]]);
      const settings = makeSettings({
        overheadRatePercent: 20,
        overheadCalculationBase: 'SELLING_PRICE',
        targetProfitAmount: 40,
        pricesIncludeVat: false,
        priceRounding: 1,
      });

      const baseVariant: MenuVariant = {
        id: 'v1',
        menuId: 'm1',
        name: 'จานปกติ',
        proteinType: 'ไก่',
        sellingPrice: 100,
        takeawayPrice: 100,
        deliveryPrice: 145,
        overheadCost: 0,
        active: true,
        recipeItems: [
          {
            id: '1',
            ingredientType: 'INGREDIENT',
            ingredientId: 'ing_chx',
            name: 'อกไก่',
            quantity: 100, // foodCost = 40
            unit: 'g',
            calculatedUnitCost: 0.4,
            calculatedLineCost: 40,
          },
        ],
      };

      // Expected: (40 + 40) / (1 - 0.20) = 80 / 0.8 = 100
      const bdAt100 = calculateVariantCostBreakdown(baseVariant, 'ข้าวมันไก่', ingMap, new Map(), settings);
      const bdAt500 = calculateVariantCostBreakdown(
        { ...baseVariant, sellingPrice: 500 },
        'ข้าวมันไก่',
        ingMap,
        new Map(),
        settings
      );

      expect(bdAt100.suggestedPriceByTargetProfit).toBe(100);
      expect(bdAt500.suggestedPriceByTargetProfit).toBe(100); // Completely invariant to current price!
      expect(roundUpToStep(80 / 0.8, 1)).toBe(100);
    });
  });

  describe('6. Sales-Weighted Food Cost % (Ex-VAT) & No Sales Empty State', () => {
    it('computes sales-weighted Food Cost % ex-VAT and returns null when no sales exist', () => {
      const emptyRes = calculateWeightedFoodCostPercent([]);
      expect(emptyRes.hasSalesData).toBe(false);
      expect(emptyRes.foodCostPercent).toBeNull();

      // Dish A (high volume, 20% FC): 100 units * 107 THB = 10,700 gross (10,000 net ex-VAT), cost = 2,000
      // Dish B (low volume, 50% FC): 1 unit * 107 THB = 107 gross (100 net ex-VAT), cost = 50
      // Unweighted average would say (20 + 50)/2 = 35%
      // True weighted ex-VAT = 2050 / 10100 * 100 = 20.297...%
      const weighted = calculateWeightedFoodCostPercent(
        [
          {
            dishStats: {
              a: { quantity: 100, revenue: 10700, cost: 2000 },
              b: { quantity: 1, revenue: 107, cost: 50 },
            },
          },
        ],
        { pricesIncludeVat: true, vatPercent: 7 }
      );

      expect(weighted.hasSalesData).toBe(true);
      expect(weighted.totalNetRevenue).toBeCloseTo(10100, 4);
      expect(weighted.totalFoodCost).toBeCloseTo(2050, 4);
      expect(weighted.foodCostPercent!).toBeCloseTo((2050 / 10100) * 100, 4);
      expect(extractNetPriceFromMenuPrice(107, true, 7)).toBeCloseTo(100, 4);
    });
  });

  describe('7. Customer Bill Total (VAT-Inclusive + Service Charge Parity)', () => {
    it('matches POS calculateBillFinancials when isVatInclusive=true & serviceChargePercent=10 (SC separate vs included)', () => {
      const dineInChannel = {
        id: 'dine_in',
        type: 'dine_in' as const,
        name: 'Dine-In',
        nameTh: 'ทานที่ร้าน',
        commissionPercent: 0,
        packagingCost: 0,
        isActive: true,
        createdAt: '',
        updatedAt: '',
        version: 1,
      };
      const billItem = {
        dishId: 'd1',
        dishName: 'กะเพรา',
        variantId: 'v1',
        variantName: 'ปกติ',
        quantity: 1,
        unitPrice: 107,
        totalUnitCostSnapshot: 30,
        foodCostSnapshot: 30,
        dishCostSnapshot: 30,
        optionsCostSnapshot: 0,
        options: [],
        hasRecipe: true,
      };

      // Case 1: VAT inclusive menu 107, 10% SC added on top of ex-VAT net (100):
      // Net food = 100, SC = 10, VAT = 7 (on food) + 0.70 (on SC) = 7.70 -> customer pays 117.70
      const onTop = calculateBillTotal(107, 10, 7, true, false);
      const posOnTop = calculateBillFinancials([billItem], 0, 10, 7, dineInChannel, {
        pricesIncludeVat: true,
        serviceChargeIncludedInPrice: false,
      });
      expect(onTop.basePriceExVat).toBeCloseTo(100, 2);
      expect(onTop.serviceChargeAmount).toBeCloseTo(posOnTop.serviceChargeAmount, 2);
      expect(onTop.vatAmount).toBeCloseTo(posOnTop.vatAmount, 2);
      expect(onTop.totalCustomerPays).toBeCloseTo(posOnTop.grandTotal, 2);

      // Case 2: Both SC (10%) & VAT (7%) included inside 117.70 gross price
      const allIncluded = calculateBillTotal(117.7, 10, 7, true, true);
      const posAllIncluded = calculateBillFinancials(
        [{ ...billItem, unitPrice: 117.7 }],
        0,
        10,
        7,
        dineInChannel,
        {
          pricesIncludeVat: true,
          serviceChargeIncludedInPrice: true,
        }
      );
      expect(allIncluded.basePriceExVat).toBeCloseTo(100, 2);
      expect(allIncluded.serviceChargeAmount).toBeCloseTo(posAllIncluded.serviceChargeAmount, 2);
      expect(allIncluded.vatAmount).toBeCloseTo(posAllIncluded.vatAmount, 2);
      expect(allIncluded.totalCustomerPays).toBeCloseTo(posAllIncluded.grandTotal, 2);
    });
  });

  describe('8. Built-in Costing Specification Suites', () => {
    it('passes all 12 full specification tests and all 7 Section 11 tests', () => {
      const fullTests = runFullSpecificationTests();
      const failedFull = fullTests.filter((t) => !t.passed);
      expect(failedFull, `Failed full tests: ${JSON.stringify(failedFull)}`).toHaveLength(0);

      const sec11Tests = runSection11SpecificationTests();
      const failedSec11 = sec11Tests.filter((t) => !t.passed);
      expect(failedSec11, `Failed Section 11 tests: ${JSON.stringify(failedSec11)}`).toHaveLength(0);
    });
  });
});
