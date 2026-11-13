/**
 * Rule-Based Actionable Intelligence Engine ("WHAT SHOULD I DO?")
 * Deterministic financial analysis generating concrete restaurant management recommendations.
 */

import {
  Ingredient,
  MenuItem,
  SalesChannel,
  ExpenseRecord,
  DailySalesRecord,
  WasteRecord,
  BusinessSettings,
  WhatShouldIDoAdvice,
} from '../types/domain';
import { calculateMenuEngineering } from './calculations';

export function generateRestaurantAdvice(
  ingredients: Ingredient[],
  menuItems: MenuItem[],
  channels: SalesChannel[],
  expenses: ExpenseRecord[],
  sales: DailySalesRecord[],
  waste: WasteRecord[],
  settings: BusinessSettings
): WhatShouldIDoAdvice[] {
  const advices: WhatShouldIDoAdvice[] = [];

  // 1. Check Significant Ingredient Price Increases
  ingredients.forEach((ing) => {
    if (ing.priceHistory && ing.priceHistory.length >= 2) {
      const sortedHistory = [...ing.priceHistory].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const oldest = sortedHistory[0].price;
      const latest = sortedHistory[sortedHistory.length - 1].price;
      const diffPercent = oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0;

      if (diffPercent >= 8) {
        // Find how many menus use this ingredient
        const affectedMenus = menuItems.filter((menu) =>
          menu.items.some((it) => it.itemId === ing.id)
        );

        advices.push({
          id: `price-rise-${ing.id}`,
          type: diffPercent > 15 ? 'CRITICAL' : 'WARNING',
          category: 'Price Increase',
          titleTh: `ราคา "${ing.thaiName}" ปรับขึ้น +${diffPercent.toFixed(1)}%`,
          titleEn: `"${ing.englishName}" purchase price rose +${diffPercent.toFixed(1)}%`,
          descriptionTh: `ราคาซื้อขยับจาก ฿${oldest.toFixed(0)} เป็น ฿${latest.toFixed(0)} ต่อ ${ing.purchaseUnit} ส่งผลกระทบต่อ ${affectedMenus.length} เมนู`,
          descriptionEn: `Purchase price shifted from ฿${oldest.toFixed(0)} to ฿${latest.toFixed(0)} per ${ing.purchaseUnit}, affecting ${affectedMenus.length} dishes.`,
          actionRecommendationTh: `พิจารณาเจรจากับซัพพลายเออร์, หั่นวัตถุดิบอื่นทดแทน, หรือปรับราคาขายของเมนู [${affectedMenus.map((m) => m.thaiName).slice(0, 3).join(', ')}]`,
          actionRecommendationEn: `Negotiate bulk pricing with suppliers or reprice affected recipes.`,
          metricLabel: 'ราคาเปลี่ยน',
          metricValue: `+${diffPercent.toFixed(1)}%`,
          relatedEntityId: ing.id,
          relatedEntityType: 'ingredient',
        });
      }
    }
  });

  // 2. High Food Cost % above target
  const targetFoodCost = settings.defaultTargetFoodCostPercent || 30;
  menuItems.forEach((menu) => {
    menu.portions.forEach((portion) => {
      if (portion.foodCostPercent > targetFoodCost + 5) {
        const excess = portion.foodCostPercent - targetFoodCost;
        advices.push({
          id: `high-foodcost-${menu.id}-${portion.id}`,
          type: excess > 10 ? 'CRITICAL' : 'WARNING',
          category: 'Food Cost',
          titleTh: `เมนู "${menu.thaiName} (${portion.name})" Food Cost สูงเกินเป้า (${portion.foodCostPercent.toFixed(1)}%)`,
          titleEn: `"${menu.englishName} (${portion.name})" Food Cost is ${portion.foodCostPercent.toFixed(1)}% (Target: ${targetFoodCost}%)`,
          descriptionTh: `ต้นทุนอาหาร ฿${portion.directFoodCost.toFixed(1)} เทียบกับราคาขาย ฿${portion.sellingPrice} คิดเป็น ${portion.foodCostPercent.toFixed(1)}% (สูงกว่าเป้าหมาย ${excess.toFixed(1)}%)`,
          descriptionEn: `Direct food cost ฿${portion.directFoodCost.toFixed(1)} vs selling price ฿${portion.sellingPrice} (${portion.foodCostPercent.toFixed(1)}%).`,
          actionRecommendationTh: `แนะนำปรับราคาขายเป็น ฿${Math.ceil(portion.directFoodCost / (targetFoodCost / 100))} หรือปรับลดขนาดพอร์ชั่นของโปรตีนหลัก 10%`,
          actionRecommendationEn: `Recommend adjusting selling price to ฿${Math.ceil(portion.directFoodCost / (targetFoodCost / 100))} or optimizing protein portioning.`,
          metricLabel: 'Food Cost',
          metricValue: `${portion.foodCostPercent.toFixed(1)}%`,
          relatedEntityId: menu.id,
          relatedEntityType: 'menu',
        });
      }
    });
  });

  // 3. Delivery Commission Margin Erosion
  const deliveryChannels = channels.filter((c) => c.commissionPercent >= 20 && c.active);
  if (deliveryChannels.length > 0) {
    const highCommission = deliveryChannels[0];
    advices.push({
      id: `delivery-commission-alert`,
      type: 'WARNING',
      category: 'Delivery Loss',
      titleTh: `ค่า GP แพลตฟอร์มเดลิเวอรี (${highCommission.name} ${highCommission.commissionPercent}%) ดึงกำไรขั้นต้นลง`,
      titleEn: `Delivery GP Fee (${highCommission.name} ${highCommission.commissionPercent}%) reduces dish margins`,
      descriptionTh: `การขายผ่านช่องทางเดลิเวอรีมีต้นทุน GP + VAT + ค่าบรรจุภัณฑ์ ทำให้กำไรส่วนเพิ่ม (Contribution Margin) ลดลงเฉลี่ย 32-38% เมื่อเทียบกับทานที่ร้าน`,
      descriptionEn: `Platform commissions combined with packaging costs reduce delivery contribution margins significantly compared to Dine-in.`,
      actionRecommendationTh: `ตั้งราคาขายบนแพลตฟอร์มแยกต่างหาก (Markup 25-30%) และจัดทำชุดคอมโบเซ็ตเฉพาะเดลิเวอรี`,
      actionRecommendationEn: `Set channel-specific delivery menu prices (markup 25-30%) or create high-margin combo bundles.`,
      metricLabel: 'ค่าคอมมิชชั่น',
      metricValue: `${highCommission.commissionPercent}% GP`,
      relatedEntityId: highCommission.id,
      relatedEntityType: 'channel',
    });
  }

  // 4. Menu Engineering Plowhorses & Puzzles Opportunities
  const meItems = menuItems.map((m) => ({
    id: m.id,
    name: m.thaiName,
    salesVolume: m.salesVolumeMonthly || 120,
    sellingPrice: m.portions[0]?.sellingPrice || 100,
    totalDirectCost: m.portions[0]?.totalDirectCost || 35,
  }));

  const meResult = calculateMenuEngineering(meItems);
  const plowhorses = meResult.classifiedItems.filter((i) => i.category === 'PLOWHORSE');
  if (plowhorses.length > 0) {
    const topPlowhorse = plowhorses[0];
    advices.push({
      id: `plowhorse-opportunity-${topPlowhorse.id}`,
      type: 'OPPORTUNITY',
      category: 'Menu Engineering',
      titleTh: `โอกาสเพิ่มกำไรจากเมนูยอดนิยม "${topPlowhorse.name}" (Plowhorse)`,
      titleEn: `Profit enhancement opportunity on popular item "${topPlowhorse.name}"`,
      descriptionTh: `เมนูนี้ขายดีมาก (ยอดขาย ${topPlowhorse.salesVolume} จาน/เดือน) แต่มีกำไรส่วนเกินต่อจานต่ำกว่าค่าเฉลี่ย`,
      descriptionEn: `High volume (${topPlowhorse.salesVolume} dishes/mo) but below-average contribution margin.`,
      actionRecommendationTh: `การปรับขึ้นราคาเพียง ฿5 - ฿10 ต่อจาน จะสร้างกำไรสุทธิเพิ่มขึ้นทันที +฿${((topPlowhorse.salesVolume || 100) * 8).toLocaleString()} ต่อเดือน โดยไม่กระทบความต้องการซื้อ`,
      actionRecommendationEn: `A modest ฿5-10 price increase would generate +฿${((topPlowhorse.salesVolume || 100) * 8).toLocaleString()}/mo extra net profit.`,
      metricLabel: 'ยอดขายต่อเดือน',
      metricValue: `${topPlowhorse.salesVolume} จาน`,
      impactAmountThb: (topPlowhorse.salesVolume || 100) * 8,
      relatedEntityId: topPlowhorse.id,
      relatedEntityType: 'menu',
    });
  }

  // 5. Waste Alert
  const totalWasteCost = waste.reduce((sum, w) => sum + (w.totalCost || 0), 0);
  if (totalWasteCost > 1500) {
    // Find top waste reason
    const byReason: Record<string, number> = {};
    waste.forEach((w) => {
      byReason[w.reason] = (byReason[w.reason] || 0) + w.totalCost;
    });
    const topReason = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0];

    advices.push({
      id: `waste-alert-summary`,
      type: totalWasteCost > 4000 ? 'CRITICAL' : 'WARNING',
      category: 'Waste',
      titleTh: `ต้นทุนของเสียสะสมในเดือนนี้อยู่ที่ ฿${totalWasteCost.toLocaleString()}`,
      titleEn: `Cumulative monthly waste cost reached ฿${totalWasteCost.toLocaleString()}`,
      descriptionTh: `สาเหตุหลักของของเสียคือ "${topReason ? topReason[0] : 'การหมดอายุ/เน่าเสีย'}" คิดเป็นมูลค่า ฿${topReason ? topReason[1].toLocaleString() : totalWasteCost.toLocaleString()}`,
      descriptionEn: `Top waste cause is "${topReason ? topReason[0] : 'Spoilage'}" accounting for ฿${topReason ? topReason[1].toLocaleString() : totalWasteCost.toLocaleString()}.`,
      actionRecommendationTh: `ปรับรอบการสั่งซื้อผักสดและของสดให้ถี่ขึ้น (จากสัปดาห์ละ 1 ครั้งเป็น 2-3 วันต่อครั้ง) และตรวจสอบอุณหภูมิตู้แช่`,
      actionRecommendationEn: `Increase ordering frequency for perishables and audit cold storage temperatures.`,
      metricLabel: 'มูลค่าของเสีย',
      metricValue: `฿${totalWasteCost.toLocaleString()}`,
    });
  }

  return advices;
}
