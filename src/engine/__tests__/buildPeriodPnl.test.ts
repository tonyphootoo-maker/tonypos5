import { describe, it, expect } from 'vitest';
import {
  buildPeriodPnl,
  calculatePeriodExpensesAndLabor,
  calculateUsaliPnl,
  normalizeChannelId,
} from '../calculations';
import { calculateProfitAndLoss } from '../../costing/engine/calculations';
import { DailySummaryDoc, EmployeeDoc, ExpenseDoc } from '../../types';
import { DailySalesRecord } from '../../costing/types/domain';

const baseTimestamps = {
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  version: 1,
};

function makeSummary(overrides: Partial<DailySummaryDoc> = {}): DailySummaryDoc {
  return {
    id: 'sum-1',
    date: '2026-03-10',
    orderCount: 100,
    grossSales: 100000,
    discounts: 0,
    netSales: 100000,
    serviceCharge: 0,
    vat: 7000,
    totalFoodCost: 32000,
    packagingCost: 2000,
    platformFees: 0,
    paymentTotals: { cash: 50000, qr: 50000, card: 0, transfer: 0 },
    channelTotals: {
      dine_in: { orderCount: 70, netSales: 70000 },
      grab: { orderCount: 30, netSales: 30000 },
    },
    dishStats: {},
    ...baseTimestamps,
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<EmployeeDoc> = {}): EmployeeDoc {
  return {
    id: 'emp-1',
    name: 'Chef A',
    role: 'Head Chef',
    department: 'kitchen',
    roleCategory: 'direct_kitchen',
    wageType: 'monthly',
    wageAmount: 15000,
    isActive: true,
    ...baseTimestamps,
    ...overrides,
  };
}

function makeExpense(overrides: Partial<ExpenseDoc> = {}): ExpenseDoc {
  return {
    id: 'exp-1',
    title: 'Rent',
    category: 'rent',
    amount: 20000,
    date: '2026-01-01',
    isFixed: true,
    isRecurring: true,
    ...baseTimestamps,
    ...overrides,
  };
}

function makeManualSale(overrides: Partial<DailySalesRecord> = {}): DailySalesRecord {
  return {
    id: 'man-1',
    date: '2026-03-10',
    channelId: 'dine-in',
    channelName: 'Dine-in',
    grossSales: 0,
    discounts: 0,
    refunds: 0,
    netSales: 0,
    orderCount: 1,
    platformFees: 0,
    actualPayout: 0,
    isVatInclusive: false,
    vatRatePercent: 7,
    ...overrides,
  };
}

describe('buildPeriodPnl — Single Source of Truth P&L Engine', () => {
  it('matches the exact hand-computed acceptance test to every decimal', () => {
    // Dine-in net ex-VAT = 70,000 + Grab net ex-VAT = 30,000 => total netSalesExVat = 100,000
    // Grab GP = 30% + 7% VAT on GP => 30,000 * 0.30 * 1.07 = 9,630.00
    const grabPlatformFee = 30000 * 0.3 * 1.07;

    const summary = makeSummary({
      netSales: 100000,
      grossSales: 107000,
      vat: 7000,
      totalFoodCost: 32000,
      packagingCost: 2000,
      platformFees: grabPlatformFee,
      channelTotals: {
        dine_in: { orderCount: 70, netSales: 70000 },
        grab: { orderCount: 30, netSales: 30000 },
      },
    });

    const employees: EmployeeDoc[] = [
      makeEmployee({
        id: 'emp-kitchen',
        name: 'Chef',
        role: 'Chef',
        department: 'kitchen',
        roleCategory: 'direct_kitchen',
        wageAmount: 15000,
      }),
      makeEmployee({
        id: 'emp-foh',
        name: 'Server',
        role: 'Cashier',
        department: 'front_of_house',
        roleCategory: 'direct_service',
        wageAmount: 10000,
      }),
    ];

    const expenses: ExpenseDoc[] = [
      makeExpense({
        id: 'exp-opex',
        title: 'Store Rent & Overhead',
        amount: 20000,
        date: '2026-03-01',
      }),
    ];

    const pnl = buildPeriodPnl({
      summaries: [summary],
      manualSales: [],
      expenses,
      employees,
      period: 'month',
      dateParam: '2026-03',
      settings: {
        serviceChargeTreatment: 'staff_pool',
        vatPercent: 7,
        incomeTaxRatePercent: 20,
      },
      cogsMode: 'estimated',
    });

    expect(pnl.netSalesExVat).toBe(100000);
    expect(pnl.totalRevenue).toBe(100000);
    expect(pnl.foodCogs).toBe(32000);
    expect(pnl.packagingCogs).toBe(2000);
    expect(pnl.totalCogs).toBe(34000);
    expect(pnl.grossProfit).toBe(66000);
    expect(pnl.channelFees).toBe(9630);
    expect(pnl.kitchenLabor).toBe(15000);
    expect(pnl.fohLabor).toBe(10000);
    expect(pnl.totalLabor).toBe(25000);
    expect(pnl.opex).toBe(20000);
    expect(pnl.operatingProfit).toBe(11370);
    expect(pnl.primeCost).toBe(59000);
    expect(pnl.primeCostPercent).toBe(59);
    expect(pnl.estimatedTax).toBe(2274);
    expect(pnl.netProfit).toBe(9096);
    expect(pnl.cogsStatus).toBe('complete');

    // Cross-engine consistency check: costing calculateProfitAndLoss produces identical values
    const costingPnl = calculateProfitAndLoss(
      107000,
      0,
      0,
      32000,
      2000,
      20000,
      15000,
      20,
      10000,
      grabPlatformFee,
      100000
    );
    expect(costingPnl.netSales).toBe(pnl.netSalesExVat);
    expect(costingPnl.grossProfit).toBe(pnl.grossProfit);
    expect(costingPnl.channelFees).toBe(pnl.channelFees);
    expect(costingPnl.totalLabor).toBe(pnl.totalLabor);
    expect(costingPnl.primeCost).toBe(pnl.primeCost);
    expect(costingPnl.primeCostPercent).toBe(pnl.primeCostPercent);
    expect(costingPnl.operatingProfit).toBe(pnl.operatingProfit);
    expect(costingPnl.taxAmount).toBe(pnl.estimatedTax);
    expect(costingPnl.netProfit).toBe(pnl.netProfit);

    // Cross-engine consistency check: calculateUsaliPnl produces identical operating profit & prime cost
    const periodAlloc = calculatePeriodExpensesAndLabor('month', '2026-03', expenses, employees, [summary]);
    const usaliPnl = calculateUsaliPnl([summary], periodAlloc, 'staff_pool');
    expect(usaliPnl.grossProfit).toBe(pnl.grossProfit);
    expect(usaliPnl.primeCost).toBe(pnl.primeCost);
    expect(usaliPnl.primeCostPercent).toBe(pnl.primeCostPercent);
    expect(usaliPnl.netOperatingProfit).toBe(pnl.operatingProfit);
  });

  it('uses ex-VAT netSales from manualSales and never overstates revenue by 7% on VAT-inclusive records', () => {
    const manualVatInclusive = makeManualSale({
      id: 'man-vat-inc',
      date: '2026-03-11',
      channelId: 'dine-in',
      grossSales: 107000,
      discounts: 0,
      refunds: 0,
      netSales: 100000,
      isVatInclusive: true,
      vatRatePercent: 7,
      foodCost: 30000,
      packagingCost: 0,
    });

    // Record without precomputed netSales but marked isVatInclusive: true -> divides 107000 / 1.07 = 100000
    const manualNoNetField = makeManualSale({
      id: 'man-vat-fallback',
      date: '2026-03-12',
      channelId: 'grab',
      grossSales: 10700,
      discounts: 0,
      refunds: 0,
      netSales: undefined as unknown as number,
      isVatInclusive: true,
      vatRatePercent: 7,
      foodCost: 3200,
      packagingCost: 300,
      platformFees: 3210,
    });

    const pnl = buildPeriodPnl({
      summaries: [],
      manualSales: [manualVatInclusive, manualNoNetField],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: { vatPercent: 7, serviceChargeTreatment: 'staff_pool', incomeTaxRatePercent: 20 },
      cogsMode: 'estimated',
    });

    expect(pnl.netSalesExVat).toBe(110000);
    expect(pnl.grossSalesRef).toBe(117700);
    expect(pnl.channelFees).toBe(3210);
    expect(pnl.foodCogs).toBe(33200);
    expect(pnl.packagingCogs).toBe(300);
    expect(pnl.cogsStatus).toBe('complete');
  });

  it('normalizes channel IDs and deduplicates manualSales vs POS summaries (never Math.max)', () => {
    expect(normalizeChannelId('dine-in')).toBe('dine_in');
    expect(normalizeChannelId('GrabFood')).toBe('grab');
    expect(normalizeChannelId('LINE-MAN')).toBe('lineman');
    expect(normalizeChannelId('take-away')).toBe('takeaway');

    // POS summary covers dine_in on 2026-03-10 with 70,000
    const posSummary = makeSummary({
      date: '2026-03-10',
      netSales: 70000,
      totalFoodCost: 22400,
      packagingCost: 0,
      platformFees: 0,
      channelTotals: {
        dine_in: { orderCount: 70, netSales: 70000 },
      },
    });

    // Duplicate manual record for 'dine-in' with HIGHER amount (95,000) & pos_sync_ fallback -> must be skipped
    const duplicateDineIn = makeManualSale({
      id: 'man-dup-dinein',
      date: '2026-03-10',
      channelId: 'dine-in',
      netSales: 95000,
      foodCost: 28000,
    });
    const duplicatePosSync = makeManualSale({
      id: 'pos_sync_2026-03-10',
      date: '2026-03-10',
      channelId: 'pos',
      netSales: 88000,
    });
    // Uncovered channel ('grab') on same date -> MUST be included cleanly
    const uncoveredGrab = makeManualSale({
      id: 'man-grab-uncovered',
      date: '2026-03-10',
      channelId: 'grab',
      netSales: 30000,
      platformFees: 9630,
      foodCost: 9600,
      packagingCost: 2000,
    });

    const pnl = buildPeriodPnl({
      summaries: [posSummary],
      manualSales: [duplicateDineIn, duplicatePosSync, uncoveredGrab],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: { serviceChargeTreatment: 'staff_pool', incomeTaxRatePercent: 20 },
      cogsMode: 'estimated',
    });

    expect(pnl.netSalesExVat).toBe(100000);
    expect(pnl.channelFees).toBe(9630);
    expect(pnl.foodCogs).toBe(32000);
    expect(pnl.packagingCogs).toBe(2000);
    expect(pnl.sourcesUsed.posSummaryCount).toBe(1);
    expect(pnl.sourcesUsed.manualSalesCount).toBe(1);
    expect(pnl.sourcesUsed.deduplicatedManualSkippedCount).toBe(2);
  });

  it('handles serviceChargeTreatment: excludes staff_pool from revenue, includes retained in revenue', () => {
    const summary = makeSummary({
      netSales: 100000,
      serviceCharge: 10000,
      totalFoodCost: 30000,
      packagingCost: 0,
      platformFees: 0,
    });

    const staffPoolPnl = buildPeriodPnl({
      summaries: [summary],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: { serviceChargeTreatment: 'staff_pool', incomeTaxRatePercent: 20 },
      cogsMode: 'estimated',
    });
    expect(staffPoolPnl.serviceChargeCollected).toBe(10000);
    expect(staffPoolPnl.retainedServiceCharge).toBe(0);
    expect(staffPoolPnl.totalRevenue).toBe(100000);
    expect(staffPoolPnl.grossProfit).toBe(70000);

    const retainedPnl = buildPeriodPnl({
      summaries: [summary],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: { serviceChargeTreatment: 'retained', incomeTaxRatePercent: 20 },
      cogsMode: 'estimated',
    });
    expect(retainedPnl.serviceChargeCollected).toBe(10000);
    expect(retainedPnl.retainedServiceCharge).toBe(10000);
    expect(retainedPnl.totalRevenue).toBe(110000);
    expect(retainedPnl.grossProfit).toBe(80000);
  });

  it('respects recurring expense endDate and date-bounds one-off expenses without multi-month inflation', () => {
    const expenses: ExpenseDoc[] = [
      // Recurring rent active Jan 2024 -> Mar 2024 only
      makeExpense({
        id: 'exp-rent-bounded',
        title: 'Temporary Kiosk Rent',
        amount: 31000,
        date: '2024-01-01',
        endDate: '2024-03-31',
        isFixed: true,
        isRecurring: true,
      }),
      // One-off repair in Feb 2024 (must NOT appear in March, and only 1x in year)
      makeExpense({
        id: 'exp-oneoff-feb',
        title: 'Oven Repair',
        category: 'repairs',
        amount: 5000,
        date: '2024-02-14',
        isFixed: false,
        isRecurring: false,
      }),
    ];

    // March 2024 (month within endDate): rent 31,000 included, Feb one-off excluded
    const marchPnl = calculatePeriodExpensesAndLabor('month', '2024-03', expenses, []);
    expect(marchPnl.operatingExpenses).toBe(31000);

    // Day in March (31 days in March): 31,000 / 31 = 1,000/day
    const marchDayPnl = calculatePeriodExpensesAndLabor('day', '2024-03-15', expenses, []);
    expect(marchDayPnl.operatingExpenses).toBe(1000);

    // April 2024 (after endDate 2024-03-31): rent stopped -> 0
    const aprilPnl = calculatePeriodExpensesAndLabor('month', '2024-04', expenses, []);
    expect(aprilPnl.operatingExpenses).toBe(0);

    // Year 2024 (12 covered months): recurring rent still runs only Jan..Mar (3 months = 93,000) + 5,000 one-off = 98,000
    const yearSummaries = ['2024-01-10', '2024-04-10'].map((d, idx) =>
      makeSummary({ id: `s-${idx}`, date: d, netSales: 50000 })
    );
    const yearAlloc = calculatePeriodExpensesAndLabor('year', '2024', expenses, [], yearSummaries);
    expect(yearAlloc.coveredMonths).toBe(12);
    expect(yearAlloc.fixedExpenses).toBe(93000);
    expect(yearAlloc.variableExpenses).toBe(5000);
    expect(yearAlloc.operatingExpenses).toBe(98000);
  });

  it('includes all active departments + overtime + benefits in Total Labor and skips inactive employees', () => {
    const employees: EmployeeDoc[] = [
      makeEmployee({
        id: 'k1',
        department: 'kitchen',
        roleCategory: 'direct_kitchen',
        wageType: 'monthly',
        wageAmount: 14000,
        benefitsMonthly: 1000,
        isActive: true,
      }),
      makeEmployee({
        id: 'f1',
        department: 'front_of_house',
        roleCategory: 'direct_service',
        wageType: 'hourly',
        wageAmount: 100,
        workDaysOrHoursPerMonth: 80,
        overtimeHoursMonthly: 10,
        overtimeRateMultiplier: 1.5, // 8,000 + 1,500 = 9,500
        benefitsMonthly: 500, // total 10,000
        isActive: true,
      }),
      makeEmployee({
        id: 'inactive',
        department: 'management',
        roleCategory: 'indirect_management',
        wageType: 'monthly',
        wageAmount: 50000,
        isActive: false,
      }),
    ];

    const pnl = buildPeriodPnl({
      summaries: [makeSummary({ netSales: 100000, totalFoodCost: 30000, packagingCost: 0, platformFees: 0 })],
      expenses: [],
      employees,
      period: 'month',
      dateParam: '2026-03',
      settings: { incomeTaxRatePercent: 20 },
      cogsMode: 'estimated',
    });

    expect(pnl.kitchenLabor).toBe(15000);
    expect(pnl.fohLabor).toBe(10000);
    expect(pnl.totalLabor).toBe(25000);
    expect(pnl.primeCost).toBe(55000); // 30,000 COGS + 25,000 Total Labor
  });

  it('sets estimatedTax to 0 when operatingProfit <= 0', () => {
    const pnl = buildPeriodPnl({
      summaries: [makeSummary({ netSales: 50000, totalFoodCost: 30000, packagingCost: 5000, platformFees: 0 })],
      expenses: [makeExpense({ amount: 25000, date: '2026-03-01' })],
      employees: [makeEmployee({ wageAmount: 10000 })],
      period: 'month',
      dateParam: '2026-03',
      settings: { incomeTaxRatePercent: 20 },
      cogsMode: 'estimated',
    });

    // Gross profit = 15,000; OPEX + Labor = 35,000 => Operating loss = -20,000
    expect(pnl.operatingProfit).toBe(-20000);
    expect(pnl.estimatedTax).toBe(0);
    expect(pnl.netProfit).toBe(-20000);
  });

  it('accumulates unrounded floats and applies roundTo2 only on final return values (Rule 3)', () => {
    // 3 summaries each 100.004 -> sum = 300.012 -> rounded = 300.01 (not 300.00)
    const summaries = [1, 2, 3].map((i) =>
      makeSummary({
        id: `frac-${i}`,
        date: `2026-03-0${i}`,
        netSales: 100.004,
        totalFoodCost: 30.004,
        packagingCost: 0,
        platformFees: 0,
        channelTotals: { dine_in: { orderCount: 1, netSales: 100.004 } },
      })
    );

    const pnl = buildPeriodPnl({
      summaries,
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: { incomeTaxRatePercent: 20 },
      cogsMode: 'estimated',
    });

    expect(pnl.netSalesExVat).toBe(300.01);
    expect(pnl.foodCogs).toBe(90.01);
    expect(pnl.grossProfit).toBe(210);
  });

  it('flags cogsStatus as incomplete instead of silently fabricating defaults when data is missing (Rule 2)', () => {
    // Actual COGS mode with missing beginningInventory
    const incompleteActual = buildPeriodPnl({
      summaries: [makeSummary()],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: {},
      cogsMode: 'actual',
      actualCogsInput: {
        beginningInventory: null,
        purchases: 20000,
        endingInventory: 5000,
        hasActualData: false,
      },
    });
    expect(incompleteActual.cogsStatus).toBe('incomplete');
    expect(incompleteActual.statusReasons.length).toBeGreaterThan(0);

    // Estimated mode with manual sales lacking COGS and no recipe fallback rate
    const incompleteManual = buildPeriodPnl({
      summaries: [],
      manualSales: [makeManualSale({ date: '2026-03-10', netSales: 20000 })],
      expenses: [],
      employees: [],
      period: 'month',
      dateParam: '2026-03',
      settings: {},
      cogsMode: 'estimated',
      manualFallbackRates: { foodCostPercent: null, packagingPercent: null },
    });
    expect(incompleteManual.cogsStatus).toBe('incomplete');
    expect(incompleteManual.foodCogs).toBe(0);
  });
});
