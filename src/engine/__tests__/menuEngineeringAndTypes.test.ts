import { describe, it, expect } from 'vitest';
import {
  calculateMenuEngineering,
  calculateSellingPriceFoodCostPercent,
  calculateTieredSuggestedPrices,
  calculateRoundedExVatSuggestedPrice,
  calculateDetailedBreakEven,
} from '../../costing/engine/calculations';
import { calculateChannelSuggestedPrices } from '../../costing/services/calculationEngine';
import {
  calculateExVatFoodCostPercent,
  calculateExVatSuggestedNetPrice,
  calculateSimpleMonthlyBreakEven,
} from '../calculations';
import type {
  ExpenseRecord as IndexExpenseRecord,
  Employee as IndexEmployee,
  RestaurantSettings,
} from '../../costing/types';
import type {
  ExpenseRecord as DomainExpenseRecord,
  Employee as DomainEmployee,
  BusinessSettings,
} from '../../costing/types/domain';

describe('Instruction Set 6: Kasavana & Smith Menu Engineering, Disambiguated Functions & Type Parity', () => {
  describe('1. Kasavana & Smith Menu Engineering (calculateMenuEngineering)', () => {
    it('classifies A=STAR, B=STAR, C=DOG, D=DOG using weighted CM (39.375) and 70% popularity threshold (28)', () => {
      const result = calculateMenuEngineering([
        { id: 'A', name: 'Menu A', salesVolume: 100, sellingPrice: 100, totalDirectCost: 60 }, // CM = 40
        { id: 'B', name: 'Menu B', salesVolume: 30, sellingPrice: 100, totalDirectCost: 40 },  // CM = 60
        { id: 'C', name: 'Menu C', salesVolume: 20, sellingPrice: 100, totalDirectCost: 80 },  // CM = 20
        { id: 'D', name: 'Menu D', salesVolume: 10, sellingPrice: 100, totalDirectCost: 90 },  // CM = 10
      ]);

      expect(result.totalVolume).toBe(160);
      // Σ(CM * qty) = 4000 + 1800 + 400 + 100 = 6300
      expect(result.totalProfit).toBe(6300);
      // Weighted Avg CM = 6300 / 160 = 39.375
      expect(result.weightedAverageMargin).toBeCloseTo(39.375, 6);
      expect(result.averageMargin).toBeCloseTo(39.375, 6);
      // Popularity threshold = 0.7 * (1/4) * 160 = 28
      expect(result.popularityThreshold).toBeCloseTo(28, 6);

      const byId = new Map(result.classifiedItems.map((it) => [it.id, it]));
      expect(byId.get('A')?.contributionMargin).toBe(40);
      expect(byId.get('B')?.contributionMargin).toBe(60);
      expect(byId.get('C')?.contributionMargin).toBe(20);
      expect(byId.get('D')?.contributionMargin).toBe(10);

      expect(byId.get('A')?.category).toBe('STAR');
      expect(byId.get('B')?.category).toBe('STAR');
      expect(byId.get('C')?.category).toBe('DOG');
      expect(byId.get('D')?.category).toBe('DOG');
    });

    it('subtracts packagingCost & delivery platformFeePerItem from ex-VAT selling price for item CM and detects PLOWHORSE & PUZZLE', () => {
      // Price 107 incl 7% VAT => ex-VAT = 100; Food 30, Pkg 5, Delivery GP 25 => CM = 40
      const result = calculateMenuEngineering([
        {
          id: 'deliv-star',
          name: 'Delivery Signature',
          salesVolume: 60,
          sellingPrice: 107,
          foodCost: 30,
          totalDirectCost: 30,
          packagingCost: 5,
          platformFeePerItem: 25,
          isVatInclusive: true,
          vatRatePercent: 7,
        },
        {
          id: 'plow',
          name: 'High Vol Low Margin',
          salesVolume: 100,
          sellingPrice: 50,
          totalDirectCost: 35, // CM = 15
        },
        {
          id: 'puzzle',
          name: 'Low Vol High Margin',
          salesVolume: 10,
          sellingPrice: 200,
          totalDirectCost: 50, // CM = 150
        },
      ]);

      // totalVolume = 170; threshold = 0.7 * (1/3) * 170 = 39.6667
      // weighted CM = (60*40 + 100*15 + 10*150) / 170 = (2400 + 1500 + 1500) / 170 = 31.7647
      const byId = new Map(result.classifiedItems.map((it) => [it.id, it]));
      expect(byId.get('deliv-star')?.sellingPriceExVat).toBeCloseTo(100, 4);
      expect(byId.get('deliv-star')?.contributionMargin).toBeCloseTo(40, 4);
      expect(byId.get('deliv-star')?.category).toBe('STAR');
      expect(byId.get('plow')?.category).toBe('PLOWHORSE');
      expect(byId.get('puzzle')?.category).toBe('PUZZLE');
    });

    it('handles empty input gracefully', () => {
      const empty = calculateMenuEngineering([]);
      expect(empty.classifiedItems).toEqual([]);
      expect(empty.popularityThreshold).toBe(0);
      expect(empty.weightedAverageMargin).toBe(0);
    });
  });

  describe('2. Disambiguated Engine Functions & Ex-VAT / Incl-VAT Contracts', () => {
    it('computes Food Cost % cleanly via both ex-VAT and menu-price functions', () => {
      expect(calculateExVatFoodCostPercent(35, 100)).toBe(35);
      expect(calculateSellingPriceFoodCostPercent(35, 100)).toBe(35);
    });

    it('computes suggested pricing cleanly with distinct disambiguated functions', () => {
      expect(calculateExVatSuggestedNetPrice(30, 30)).toBeCloseTo(100, 2);

      const tiered = calculateTieredSuggestedPrices(30, 30, 'food_cost_target');
      expect(tiered.recommendedPrice).toBe(100);
      expect(tiered.minimumPrice).toBe(75); // 30 / 0.40

      const rounded = calculateRoundedExVatSuggestedPrice(30, 35, 5);
      // 30 / 0.35 = 85.71 -> step 5 => 90
      expect(rounded.roundedPrice).toBe(90);

      const channelsExVat = calculateChannelSuggestedPrices(30, 30, 20, 0, 30, 8, {
        pricesIncludeVat: false,
        roundingStep: 1,
      });
      const channelsInclVat = calculateChannelSuggestedPrices(30, 30, 20, 0, 30, 8, {
        pricesIncludeVat: true,
        vatRatePercent: 7,
        roundingStep: 1,
      });
      expect(channelsExVat.suggestedPriceByFc).toBe(100);
      expect(channelsInclVat.suggestedPriceByFc).toBe(107);
    });

    it('computes Break-Even via both simple monthly and detailed engines consistently', () => {
      const simple = calculateSimpleMonthlyBreakEven(30000, 20000, 50, 25);
      const detailed = calculateDetailedBreakEven(50000, 50, 200, 25, 0, 120000);
      expect(simple.monthlyBreakEvenSales).toBe(100000);
      expect(simple.dailyBreakEvenSales).toBe(4000);
      expect(detailed.breakEvenSales).toBe(100000);
      expect(detailed.breakEvenDailySales).toBe(4000);
      expect(detailed.safetyMarginRevenue).toBe(20000);
    });
  });

  describe('3. Unified Domain & Index Type Parity (no as any required)', () => {
    it('assigns index types directly to domain types cleanly', () => {
      const idxExpense: IndexExpenseRecord = {
        id: 'exp-1',
        date: '2026-11-16',
        category: 'ค่าเช่า',
        description: 'Rent',
        amount: 20000,
        paymentMethod: 'โอนเงิน',
        isFixed: true,
      };
      const domExpense: DomainExpenseRecord = idxExpense;

      const idxEmployee: IndexEmployee = {
        id: 'emp-1',
        name: 'Chef A',
        position: 'Chef',
        active: true,
        wageRate: 25000,
      };
      const domEmployee: DomainEmployee = idxEmployee;

      const idxSettings: RestaurantSettings = {
        restaurantName: 'Test Shop',
        defaultOverheadCostPerDish: 0,
        targetFoodCostPercent: 35,
        takeawayPackagingCost: 5,
        deliveryPackagingCost: 8,
        channels: [],
        userRole: 'OWNER',
      };
      const domSettings: BusinessSettings = idxSettings;

      expect(domExpense.amount).toBe(20000);
      expect(domEmployee.name).toBe('Chef A');
      expect(domSettings.restaurantName).toBe('Test Shop');
    });
  });
});
