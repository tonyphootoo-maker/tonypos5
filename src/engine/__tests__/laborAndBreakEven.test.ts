import { describe, it, expect } from 'vitest';
import {
  buildPeriodPnl,
  calculateSimpleMonthlyBreakEven as calculateEngineBreakEven,
  calculatePeriodExpensesAndLabor,
  deriveVariableCostPercent,
  formatPeriodCalculationLabel,
  getEmployeeMonthlyCost,
  isExplicitPayrollExpense,
  normalizeToMonthly,
} from '../calculations';
import { calculateDetailedBreakEven as calculateCostingBreakEven } from '../../costing/engine/calculations';
import { DailySummaryDoc, EmployeeDoc, ExpenseDoc, SettingsDoc } from '../../types';
import { Employee as CostEmployee, ExpenseRecord } from '../../costing/types/domain';

const baseTimestamps = {
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  version: 1,
};

function makeSummary(overrides: Partial<DailySummaryDoc> = {}): DailySummaryDoc {
  return {
    id: 'sum-1',
    date: '2026-11-16',
    orderCount: 50,
    grossSales: 100000,
    discounts: 0,
    netSales: 100000,
    serviceCharge: 0,
    vat: 0,
    totalFoodCost: 32000,
    packagingCost: 2000,
    platformFees: 9630,
    paymentTotals: { cash: 60000, qr: 40000, card: 0, transfer: 0 },
    channelTotals: {
      dine_in: { orderCount: 35, netSales: 70000 },
      grab: { orderCount: 15, netSales: 30000 },
    },
    dishStats: {},
    ...baseTimestamps,
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<EmployeeDoc> = {}): EmployeeDoc {
  return {
    id: 'emp-1',
    name: 'Staff A',
    role: 'Kitchen Staff',
    department: 'kitchen',
    roleCategory: 'direct_kitchen',
    wageType: 'monthly',
    wageAmount: 25000,
    isActive: true,
    ...baseTimestamps,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<SettingsDoc> = {}): SettingsDoc {
  return {
    id: 'settings-1',
    shopName: 'Test Kitchen',
    shopAddress: '123 Main Rd',
    shopPhone: '080-000-0000',
    taxId: '0105500000000',
    receiptHeader: 'Thank you',
    receiptFooter: 'Visit again',
    targetFoodCostPercent: 35,
    vatPercent: 7,
    serviceChargePercent: 0,
    pricesIncludeVat: false,
    serviceChargeIncludedInPrice: false,
    serviceChargeTreatment: 'staff_pool',
    commissionBase: 'net_food_sales',
    commissionVatAsCost: true,
    operatingDaysPerMonth: 26,
    incomeTaxRatePercent: 20,
    socialSecurityEnabled: false,
    socialSecurityRatePercent: 5,
    socialSecurityCapWage: 15000,
    dailyClosingTime: '04:00',
    pointsEarnUnitThb: 100,
    pointsRedeemValueThb: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('Instruction Set 3: Labor %, Break-Even & Safety Margin Consistency', () => {
  describe('1. Period consistency for Labor % and normalizeToMonthly', () => {
    it('keeps monthly and daily Labor % identical in a 30-day month and restores monthly value cleanly', () => {
      // Monthly: 25,000 payroll / 100,000 Net Sales = 25.0%
      // Daily (2026-11-16, November has 30 days): 833.33... payroll / 3,333.33... Net Sales = 25.0%
      const staff = [makeEmployee({ wageType: 'monthly', wageAmount: 25000 })];
      const rent: ExpenseDoc = {
        id: 'exp-rent',
        title: 'Store Rent',
        category: 'rent',
        amount: 20000,
        date: '2026-01-01',
        isFixed: true,
        isRecurring: true,
        ...baseTimestamps,
      };

      const monthlyNetSales = 100000;
      const dailyNetSales = monthlyNetSales / 30;

      const monthlyPnl = buildPeriodPnl({
        summaries: [makeSummary({ date: '2026-11-16', netSales: monthlyNetSales, grossSales: monthlyNetSales })],
        expenses: [rent],
        employees: staff,
        period: 'month',
        dateParam: '2026-11',
        settings: makeSettings(),
        cogsMode: 'estimated',
        todayDate: '2026-11-30',
      });

      const dailyPnl = buildPeriodPnl({
        summaries: [makeSummary({ date: '2026-11-16', netSales: dailyNetSales, grossSales: dailyNetSales })],
        expenses: [rent],
        employees: staff,
        period: 'day',
        dateParam: '2026-11-16',
        settings: makeSettings(),
        cogsMode: 'estimated',
        todayDate: '2026-11-30',
      });

      expect(monthlyPnl.totalLabor).toBeCloseTo(25000, 2);
      expect(monthlyPnl.laborPercent).toBeCloseTo(25.0, 2);

      // Daily allocated labor = 25000 / 30 = 833.33
      expect(dailyPnl.totalLabor).toBeCloseTo(25000 / 30, 2);
      expect(dailyPnl.laborPercent).toBeCloseTo(25.0, 2);

      // normalizeToMonthly restores unrounded daily net sales back to exact 100,000 (30-day Nov)
      expect(normalizeToMonthly(dailyNetSales, 'day', dailyPnl.coveredMonths, '2026-11-16')).toBeCloseTo(100000, 2);
      expect(normalizeToMonthly(dailyPnl.netSalesExVat, 'day', dailyPnl.coveredMonths, '2026-11-16')).toBeCloseTo(99999.9, 2);

      // Uses real calendar days for February 2026 (28 days) vs Leap Year February 2024 (29 days)
      expect(normalizeToMonthly(1000, 'day', undefined, '2026-02-10')).toBe(28000);
      expect(normalizeToMonthly(1000, 'day', undefined, '2024-02-10')).toBe(29000);

      // Year normalization divides by actual coveredMonths (e.g. 10 months, not forced 12)
      expect(normalizeToMonthly(1000000, 'year', 10, '2026')).toBe(100000);
    });

    it('generates clear period calculation labels in Thai and English', () => {
      expect(formatPeriodCalculationLabel('month', '2026-11', 'th')).toBe('คำนวณจากยอดขายเดือน 2026-11');
      expect(formatPeriodCalculationLabel('day', '2026-11-16', 'th')).toBe('คำนวณจากยอดขายวันที่ 2026-11-16');
      expect(formatPeriodCalculationLabel('year', '2026', 'th')).toBe('คำนวณจากยอดขายปี 2026');
    });
  });

  describe('2. Unified getEmployeeMonthlyCost (Hourly, OT, Benefits, Optional SSO)', () => {
    it('calculates hourly wage * hours correctly instead of returning raw rate 65', () => {
      const hourlyWorker: CostEmployee = {
        id: 'emp-hr',
        name: 'Part-time Barista',
        position: 'Barista',
        role: 'Barista',
        roleCategory: 'direct_service',
        department: 'front_of_house',
        employmentType: 'hourly',
        type: 'hourly',
        wageRate: 65,
        standardHoursPerMonth: 200,
        overtimeHoursMonthly: 0,
        overtimeRateMultiplier: 1.5,
        benefitsMonthly: 0,
        active: true,
      };

      expect(getEmployeeMonthlyCost(hourlyWorker)).toBe(13000);
    });

    it('preserves benefitsMonthly and OT even when monthlyCost is provided (parenthesized precedence fix)', () => {
      const staffWithMonthlyCostAndExtras: CostEmployee = {
        id: 'emp-ext',
        name: 'Line Cook',
        position: 'Cook',
        role: 'Cook',
        roleCategory: 'direct_kitchen',
        type: 'monthly',
        wageRate: 15000,
        monthlyCost: 15000,
        standardHoursPerMonth: 208,
        benefitsMonthly: 1200,
        overtimeHoursMonthly: 10,
        overtimeRateMultiplier: 1.5,
        active: true,
      };

      // OT = (15000 / 208) * 10 * 1.5 = 1081.730769...
      const expectedOt = (15000 / 208) * 10 * 1.5;
      const expectedTotal = 15000 + expectedOt + 1200;
      expect(getEmployeeMonthlyCost(staffWithMonthlyCostAndExtras)).toBeCloseTo(expectedTotal, 2);
    });

    it('computes optional Employer Social Security (5% capped at 15,000 THB = max 750/mo)', () => {
      const highSalaryStaff = makeEmployee({ wageType: 'monthly', wageAmount: 20000 });
      const hourlyStaff: CostEmployee = {
        id: 'emp-h2',
        name: 'Cashier',
        position: 'Cashier',
        roleCategory: 'direct_service',
        type: 'hourly',
        employmentType: 'hourly',
        wageRate: 65,
        standardHoursPerMonth: 200, // baseMonthly = 13,000
        overtimeHoursMonthly: 0,
        overtimeRateMultiplier: 1.5,
        benefitsMonthly: 500,
        active: true,
      };

      // SSO disabled => 0 SSO
      expect(getEmployeeMonthlyCost(highSalaryStaff, { socialSecurityEnabled: false })).toBe(20000);
      expect(getEmployeeMonthlyCost(hourlyStaff, { socialSecurityEnabled: false })).toBe(13500);

      // SSO enabled => 5% capped at 15,000 (max 750)
      const ssoOpts = { socialSecurityEnabled: true, socialSecurityRatePercent: 5, socialSecurityCapWage: 15000 };
      expect(getEmployeeMonthlyCost(highSalaryStaff, ssoOpts)).toBe(20750); // 20000 + 750
      expect(getEmployeeMonthlyCost(hourlyStaff, ssoOpts)).toBe(14150); // 13000 + 500 + (13000 * 0.05 = 650)

      // Inactive employee always returns 0 even with SSO enabled
      expect(getEmployeeMonthlyCost({ ...highSalaryStaff, isActive: false }, ssoOpts)).toBe(0);
    });
  });

  describe('3. Break-Even, CM%, Variable Expenses, and No Silent 65% Default', () => {
    it('computes Break-Even = 45,000 / 56.37% ≈ 79,830/mo when CM% comes from real sales data', () => {
      // Fixed costs = 45,000 (e.g. rent 20,000 + staff 25,000)
      // 30d Real Sales = 100,000; Food = 32,000 (32%); Pkg = 2,000 (2%); GP = 9,630 (9.63%)
      // Total Var% = 43.63% -> CM% = 56.37% -> Break-even = 45,000 / 0.5637 = 79,829.70
      const summary = makeSummary({
        netSales: 100000,
        totalFoodCost: 32000,
        packagingCost: 2000,
        platformFees: 9630,
      });

      const margin = deriveVariableCostPercent([summary]);
      expect(margin.hasRealData).toBe(true);
      expect(margin.isAssumed).toBe(false);
      expect(margin.foodCostPercent).toBe(32);
      expect(margin.packagingPercent).toBe(2);
      expect(margin.platformFeePercent).toBe(9.63);
      expect(margin.variableCostPercent).toBe(43.63);
      expect(margin.contributionMarginPercent).toBe(56.37);

      const costingBe = calculateCostingBreakEven(45000, margin.contributionMarginPercent, 200, 30, 0, 100000);
      expect(costingBe.isValid).toBe(true);
      expect(Math.round(costingBe.breakEvenSales)).toBe(79830);
      // Normalized Safety Margin on 100,000 monthly sales: (100000 - 79829.70) / 100000 * 100 = 20.17%
      expect(costingBe.safetyMarginPercent).toBeCloseTo(20.17, 1);

      const engineBe = calculateEngineBreakEven(20000, 25000, margin.contributionMarginPercent, 30);
      expect(engineBe.monthlyBreakEvenSales).toBe(79829.7);
    });

    it('flows non-fixed (variable) expenses into CM% rather than into Fixed Costs', () => {
      const summary = makeSummary({
        netSales: 100000,
        totalFoodCost: 32000,
        packagingCost: 2000,
        platformFees: 9630,
      });

      // Add 5,000 THB/month of non-fixed variable operating expense (e.g. packaging bags/disposables in OPEX = 5%)
      const marginWithVarOpex = deriveVariableCostPercent([summary], {
        otherVariableCostAmount: 5000,
      });

      expect(marginWithVarOpex.otherVariableCostPercent).toBe(5);
      expect(marginWithVarOpex.variableCostPercent).toBe(48.63);
      expect(marginWithVarOpex.contributionMarginPercent).toBe(51.37);

      const costs = calculatePeriodExpensesAndLabor(
        'month',
        '2026-11',
        [
          {
            id: 'f1',
            title: 'Rent',
            category: 'rent',
            amount: 20000,
            date: '2026-01-01',
            isFixed: true,
            isRecurring: true,
            ...baseTimestamps,
          },
          {
            id: 'v1',
            title: 'Variable Promo Commission',
            category: 'marketing',
            amount: 5000,
            date: '2026-11-05',
            isFixed: false,
            isRecurring: false,
            ...baseTimestamps,
          },
        ],
        [makeEmployee({ wageAmount: 25000 })]
      );

      expect(costs.fixedExpenses).toBe(20000);
      expect(costs.variableExpenses).toBe(5000);
      expect(costs.laborCost).toBe(25000);
    });

    it('never silently defaults to 65% CM when real sales data is missing', () => {
      const emptyMargin = deriveVariableCostPercent([]);
      expect(emptyMargin.hasRealData).toBe(false);
      expect(emptyMargin.isAssumed).toBe(true);
      expect(emptyMargin.contributionMarginPercent).toBe(0);

      const be = calculateCostingBreakEven(45000, emptyMargin.contributionMarginPercent, 150, 26);
      expect(be.isValid).toBe(false);
      expect(be.breakEvenSales).toBe(0);
    });
  });

  describe('4. Explicit Payroll Detection (No Brittle Keyword False Positives)', () => {
    it('does NOT misclassify "ค่าแรงช่างซ่อมแอร์" in Repair & Maintenance as staff payroll', () => {
      const acRepairExpense: Partial<ExpenseRecord> = {
        category: 'Repair & Maintenance',
        description: 'ค่าแรงช่างซ่อมแอร์',
        amount: 2500,
      };
      expect(isExplicitPayrollExpense(acRepairExpense)).toBe(false);

      // Explicit isPayroll: true marks it as staff payroll regardless of description/category
      const customPayrollExpense: Partial<ExpenseRecord> = {
        category: 'Other Operating Expenses',
        description: 'โบนัสพนักงานประจำ',
        isPayroll: true,
      };
      expect(isExplicitPayrollExpense(customPayrollExpense)).toBe(true);

      // Legacy category fallback when isPayroll is undefined
      const legacyLaborCat: Partial<ExpenseRecord> = {
        category: 'Labor (Salary & Wages)',
        description: 'Staff Salary',
      };
      expect(isExplicitPayrollExpense(legacyLaborCat)).toBe(true);

      // Explicit isPayroll: false overrides legacy category
      const explicitOverride: Partial<ExpenseRecord> = {
        category: 'Labor (Salary & Wages)',
        description: 'ค่าจ้างผู้รับเหมาตกแต่งร้าน',
        isPayroll: false,
      };
      expect(isExplicitPayrollExpense(explicitOverride)).toBe(false);
    });
  });
});
