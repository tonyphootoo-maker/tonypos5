import { describe, it, expect } from 'vitest';
import {
  applyBillToDailySummary,
  revertBillFromDailySummary,
  createEmptyDailySummary,
} from '../../data/db';
import { convertDailySummariesToSalesRecords } from '../../costing/services/firebaseSyncService';
import {
  upsertDailySalesRecord,
  normalizeUpsertChannelId,
  calculateChannelPlatformFees,
} from '../../costing/engine/calculations';
import { buildPeriodPnl } from '../calculations';
import { BillDoc, DailySummaryDoc } from '../../types';
import { DailySalesRecord } from '../../costing/types/domain';

function makeBill(overrides: Partial<BillDoc> = {}): BillDoc {
  return {
    id: overrides.id || 'bill-1',
    billNumber: overrides.billNumber || 'B-001',
    status: overrides.status || 'paid',
    workDate: overrides.workDate || '2026-05-10',
    channelId: overrides.channelId || 'dine_in',
    channelName: overrides.channelName || 'Dine-in',
    orderType: overrides.orderType || 'dine_in',
    items: overrides.items || [
      {
        dishId: 'dish-1',
        dishName: 'Pad Kra Pao',
        variantId: 'var-1',
        variantName: 'Pork',
        unitPrice: 120,
        dishCostSnapshot: 35,
        optionsCostSnapshot: 0,
        foodCostSnapshot: 35,
        packagingCostSnapshot: 0,
        totalUnitCostSnapshot: 35,
        quantity: 2,
        options: [],
        hasRecipe: true,
      },
    ],
    subtotal: 240,
    discountAmount: 20,
    serviceChargeRate: 10,
    serviceChargeAmount: 22,
    vatRate: 7,
    vatAmount: 16.94,
    grandTotal: 258.94,
    netSales: 220,
    totalFoodCost: 70,
    packagingCost: 0,
    platformFee: 0,
    payments: overrides.payments || [{ method: 'cash', amount: 258.94 }],
    createdAt: '2026-05-10T10:00:00Z',
    updatedAt: '2026-05-10T10:00:00Z',
    version: 1,
    ...overrides,
  };
}

describe('POS Sales Sync, Per-Channel Totals, Void Reversion & Anti-Double-Counting', () => {
  it('1. pullDailySales (convertDailySummariesToSalesRecords) is strictly idempotent across 2 consecutive syncs', () => {
    const summary: DailySummaryDoc = {
      ...createEmptyDailySummary('2026-05-10', '2026-05-10T22:00:00Z'),
      orderCount: 15,
      grossSales: 10000,
      discounts: 700,
      netSales: 9300,
      serviceCharge: 400,
      vat: 651,
      totalFoodCost: 3100,
      packagingCost: 120,
      platformFees: 963,
      channelTotals: {
        dine_in: {
          orderCount: 10,
          netSales: 6300,
          grossSales: 6500,
          discounts: 200,
          platformFees: 0,
          totalFoodCost: 2100,
          packagingCost: 0,
          serviceCharge: 400,
        },
        grab: {
          orderCount: 5,
          netSales: 3000,
          grossSales: 3500,
          discounts: 500,
          platformFees: 963,
          totalFoodCost: 1000,
          packagingCost: 120,
          serviceCharge: 0,
        },
      },
    };

    const sync1 = convertDailySummariesToSalesRecords([summary], []);
    const sync2 = convertDailySummariesToSalesRecords([summary], sync1);

    expect(sync1).toHaveLength(2);
    expect(sync2).toHaveLength(2);
    expect(sync2).toEqual(sync1);

    const dineInRec = sync2.find((r) => r.channelId === 'dine_in')!;
    const grabRec = sync2.find((r) => r.channelId === 'grab')!;
    expect(dineInRec.id).toBe('pos_sync_2026-05-10_dine_in');
    expect(dineInRec.discounts).toBe(200);
    expect(dineInRec.serviceCharge).toBe(400);
    expect(dineInRec.platformFees).toBe(0);
    expect(dineInRec.foodCost).toBe(2100);
    expect(dineInRec.estimatedAllocation).toBe(false);

    expect(grabRec.id).toBe('pos_sync_2026-05-10_grab');
    expect(grabRec.discounts).toBe(500);
    expect(grabRec.platformFees).toBe(963);
    expect(grabRec.packagingCost).toBe(120);
    expect(grabRec.serviceCharge).toBe(0);
    expect(grabRec.estimatedAllocation).toBe(false);

    const sumNet1 = sync1.reduce((s, r) => s + r.netSales, 0);
    const sumNet2 = sync2.reduce((s, r) => s + r.netSales, 0);
    expect(sumNet1).toBe(9300);
    expect(sumNet2).toBe(9300);
  });

  it('2. Bill void/cancel reverts ALL per-channel & summary fields strictly back to pre-payment state', () => {
    const baseline = applyBillToDailySummary(
      createEmptyDailySummary('2026-05-10', '2026-05-10T10:00:00Z'),
      makeBill({
        id: 'bill-keep',
        channelId: 'dine_in',
        subtotal: 500,
        discountAmount: 50,
        netSales: 450,
        serviceChargeAmount: 45,
        vatAmount: 31.5,
        totalFoodCost: 140,
        packagingCost: 0,
        platformFee: 0,
        payments: [{ method: 'cash', amount: 526.5 }],
      })
    );

    const grabBillToVoid = makeBill({
      id: 'bill-void',
      channelId: 'grab',
      channelName: 'GrabFood',
      orderType: 'delivery',
      subtotal: 1000,
      discountAmount: 100,
      netSales: 900,
      serviceChargeAmount: 0,
      vatAmount: 0,
      totalFoodCost: 300,
      packagingCost: 24,
      platformFee: 288.9,
      payments: [{ method: 'transfer', amount: 900 }],
    });

    const afterPay = applyBillToDailySummary(baseline, grabBillToVoid, grabBillToVoid.payments);
    expect(afterPay.channelTotals.grab).toEqual({
      orderCount: 1,
      netSales: 900,
      grossSales: 1000,
      discounts: 100,
      platformFees: 288.9,
      totalFoodCost: 300,
      packagingCost: 24,
      serviceCharge: 0,
    });

    const afterVoid = revertBillFromDailySummary(afterPay, grabBillToVoid);

    // Overall summary equals baseline exactly
    expect(afterVoid.orderCount).toBe(baseline.orderCount);
    expect(afterVoid.netSales).toBe(baseline.netSales);
    expect(afterVoid.grossSales).toBe(baseline.grossSales);
    expect(afterVoid.discounts).toBe(baseline.discounts);
    expect(afterVoid.platformFees).toBe(baseline.platformFees);
    expect(afterVoid.totalFoodCost).toBe(baseline.totalFoodCost);
    expect(afterVoid.packagingCost).toBe(baseline.packagingCost);
    expect(afterVoid.serviceCharge).toBe(baseline.serviceCharge);

    // Voided channel returns strictly to zeros (no negative, no leftover discounts/fees/COGS)
    expect(afterVoid.channelTotals.grab).toEqual({
      orderCount: 0,
      netSales: 0,
      grossSales: 0,
      discounts: 0,
      platformFees: 0,
      totalFoodCost: 0,
      packagingCost: 0,
      serviceCharge: 0,
    });
    // Other channels remain completely untouched
    expect(afterVoid.channelTotals.dine_in).toEqual(baseline.channelTotals.dine_in);

    // Also test voiding a legacy summary without extended per-channel fields (must never produce NaN)
    const legacySummary: DailySummaryDoc = {
      ...createEmptyDailySummary('2026-05-09'),
      orderCount: 1,
      grossSales: 1000,
      netSales: 900,
      discounts: 100,
      platformFees: 288.9,
      channelTotals: {
        grab: { orderCount: 1, netSales: 900 },
      },
    };
    const afterLegacyVoid = revertBillFromDailySummary(legacySummary, grabBillToVoid);
    expect(afterLegacyVoid.channelTotals.grab.orderCount).toBe(0);
    expect(afterLegacyVoid.channelTotals.grab.netSales).toBe(0);
    expect(Number.isNaN(afterLegacyVoid.channelTotals.grab.discounts as any)).toBe(false);
  });

  it('3. upsertDailySalesRecord isolates channels strictly — manual grab or empty channel never overwrites dine_in', () => {
    const dineIn: DailySalesRecord = {
      id: 'sales-dinein',
      date: '2026-05-10',
      channelId: 'dine_in',
      channelName: 'หน้าร้าน',
      orderCount: 20,
      grossSales: 8000,
      discounts: 0,
      refunds: 0,
      netSales: 8000,
      platformFees: 0,
      actualPayout: 8000,
    };

    const grab: DailySalesRecord = {
      id: 'sales-grab',
      date: '2026-05-10',
      channelId: 'grab',
      channelName: 'GrabFood',
      orderCount: 10,
      grossSales: 4000,
      discounts: 200,
      refunds: 0,
      netSales: 3800,
      platformFees: 1219.8,
      actualPayout: 2580.2,
    };

    const emptyChannel: DailySalesRecord = {
      id: 'sales-empty',
      date: '2026-05-10',
      channelId: '',
      channelName: 'อื่นๆ',
      orderCount: 2,
      grossSales: 500,
      discounts: 0,
      refunds: 0,
      netSales: 500,
      platformFees: 0,
      actualPayout: 500,
    };

    let list = upsertDailySalesRecord([dineIn], grab);
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.channelId === 'dine_in')?.netSales).toBe(8000);
    expect(list.find((r) => r.channelId === 'grab')?.netSales).toBe(3800);

    // Empty channelId must NOT overwrite dine_in or grab!
    list = upsertDailySalesRecord(list, emptyChannel);
    expect(list).toHaveLength(3);
    expect(list.find((r) => r.channelId === 'dine_in')?.netSales).toBe(8000);
    expect(list.find((r) => r.channelId === 'grab')?.netSales).toBe(3800);
    expect(list.find((r) => r.channelId === '')?.netSales).toBe(500);
    expect(normalizeUpsertChannelId('')).toBe('');

    // Updating the exact same empty channel updates ONLY the empty-channel record
    list = upsertDailySalesRecord(list, { ...emptyChannel, id: 'sales-empty-2', netSales: 650 });
    expect(list).toHaveLength(3);
    expect(list.find((r) => r.channelId === '')?.netSales).toBe(650);
  });

  it('4. Legacy DailySummary without per-channel breakdown sets estimatedAllocation: true', () => {
    const legacySummary: DailySummaryDoc = {
      ...createEmptyDailySummary('2026-05-01'),
      orderCount: 10,
      grossSales: 5000,
      discounts: 300,
      netSales: 4700,
      serviceCharge: 200,
      platformFees: 642,
      channelTotals: {
        dine_in: { orderCount: 5, netSales: 2350 },
        grab: { orderCount: 5, netSales: 2350 },
      },
    };

    const records = convertDailySummariesToSalesRecords([legacySummary], []);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.estimatedAllocation === true)).toBe(true);
    expect(records.reduce((s, r) => s + (r.serviceCharge || 0), 0)).toBeCloseTo(200, 2);
  });

  it('5. buildPeriodPnl accumulates serviceCharge from synced records and obeys serviceChargeTreatment, plus replacesPosSync manual override', () => {
    const syncedRecs: DailySalesRecord[] = [
      {
        id: 'pos_sync_2026-05-10_dine_in',
        date: '2026-05-10',
        channelId: 'dine_in',
        channelName: 'หน้าร้าน',
        orderCount: 10,
        grossSales: 10000,
        discounts: 0,
        refunds: 0,
        netSales: 10000,
        serviceCharge: 1000,
        platformFees: 0,
        actualPayout: 10000,
        foodCost: 3000,
        packagingCost: 0,
      },
    ];

    const staffPoolPnl = buildPeriodPnl({
      summaries: [],
      manualSales: syncedRecs,
      expenses: [],
      employees: [],
      period: 'day',
      dateParam: '2026-05-10',
      settings: { serviceChargeTreatment: 'staff_pool', incomeTaxRatePercent: 0 },
      cogsMode: 'estimated',
    });
    expect(staffPoolPnl.serviceChargeCollected).toBe(1000);
    expect(staffPoolPnl.retainedServiceCharge).toBe(0);
    expect(staffPoolPnl.totalRevenue).toBe(10000);

    const retainedPnl = buildPeriodPnl({
      summaries: [],
      manualSales: syncedRecs,
      expenses: [],
      employees: [],
      period: 'day',
      dateParam: '2026-05-10',
      settings: { serviceChargeTreatment: 'retained', incomeTaxRatePercent: 0 },
      cogsMode: 'estimated',
    });
    expect(retainedPnl.serviceChargeCollected).toBe(1000);
    expect(retainedPnl.retainedServiceCharge).toBe(1000);
    expect(retainedPnl.totalRevenue).toBe(11000);

    // Explicit manual override ("แทนที่ POS") is preserved on subsequent pullDailySales & replaces POS channel without double-counting
    const manualOverride: DailySalesRecord = {
      id: 'sales-override-1',
      date: '2026-05-10',
      channelId: 'grab',
      channelName: 'GrabFood',
      orderCount: 8,
      grossSales: 4000,
      discounts: 0,
      refunds: 0,
      netSales: 4000,
      platformFees: 1284,
      actualPayout: 2716,
      foodCost: 1200,
      packagingCost: 64,
      replacesPosSync: true,
    };

    const summaryWithGrabAndDineIn: DailySummaryDoc = {
      ...createEmptyDailySummary('2026-05-10'),
      orderCount: 15,
      grossSales: 9000,
      netSales: 9000,
      platformFees: 963,
      totalFoodCost: 2700,
      packagingCost: 40,
      channelTotals: {
        dine_in: {
          orderCount: 10,
          netSales: 6000,
          grossSales: 6000,
          discounts: 0,
          platformFees: 0,
          totalFoodCost: 1800,
          packagingCost: 0,
          serviceCharge: 0,
        },
        grab: {
          orderCount: 5,
          netSales: 3000,
          grossSales: 3000,
          discounts: 0,
          platformFees: 963,
          totalFoodCost: 900,
          packagingCost: 40,
          serviceCharge: 0,
        },
      },
    };

    const mergedAfterSync = convertDailySummariesToSalesRecords(
      [summaryWithGrabAndDineIn],
      [manualOverride]
    );
    expect(mergedAfterSync).toHaveLength(2);
    expect(mergedAfterSync.find((r) => r.channelId === 'grab')?.id).toBe('sales-override-1');
    expect(mergedAfterSync.find((r) => r.channelId === 'grab')?.netSales).toBe(4000);

    // In buildPeriodPnl with both live summary and override record: 6,000 (POS dine_in) + 4,000 (manual grab override) = 10,000 (no double count!)
    const pnlWithOverride = buildPeriodPnl({
      summaries: [summaryWithGrabAndDineIn],
      manualSales: [manualOverride],
      expenses: [],
      employees: [],
      period: 'day',
      dateParam: '2026-05-10',
      settings: { incomeTaxRatePercent: 0 },
      cogsMode: 'estimated',
    });
    expect(pnlWithOverride.netSalesExVat).toBe(10000);
    expect(pnlWithOverride.channelFees).toBe(1284);
  });

  it('6. calculateChannelPlatformFees honors channel gpBase setting (gross_incl_vat vs net_ex_vat)', () => {
    // 1070 gross incl 7% VAT => netSalesExVat = 1000
    const grossBased = calculateChannelPlatformFees({
      grossSales: 1070,
      discounts: 0,
      refunds: 0,
      isVatInclusive: true,
      vatRatePercent: 7,
      channel: { commissionPercent: 30, taxOnCommissionPercent: 7, gpBase: 'gross_incl_vat' },
    });
    expect(grossBased.netSalesExVat).toBeCloseTo(1000, 2);
    expect(grossBased.gpFeeBase).toBeCloseTo(1070, 2);
    expect(grossBased.platformFees).toBeCloseTo(1070 * 0.3 * 1.07, 2);

    const netBased = calculateChannelPlatformFees({
      grossSales: 1070,
      discounts: 0,
      refunds: 0,
      isVatInclusive: true,
      vatRatePercent: 7,
      channel: { commissionPercent: 30, taxOnCommissionPercent: 7, gpBase: 'net_ex_vat' },
    });
    expect(netBased.netSalesExVat).toBeCloseTo(1000, 2);
    expect(netBased.gpFeeBase).toBeCloseTo(1000, 2);
    expect(netBased.platformFees).toBeCloseTo(1000 * 0.3 * 1.07, 2);
  });
});
