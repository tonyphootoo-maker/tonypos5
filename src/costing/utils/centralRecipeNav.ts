import { MenuItem, MenuVariant } from '../types';

export type CentralRecipeOriginPage =
  | 'pos'
  | 'menu_cost'
  | 'cost_food_cost'
  | 'cost_food_cost_alacarte';

export interface CentralRecipeTarget {
  variantId?: string;
  menuId?: string;
  origin: CentralRecipeOriginPage;
  nonce: number;
}

export const CENTRAL_RECIPE_BUTTON_LABELS = {
  openTh: 'เปิดสูตรกลางของเมนูนี้',
  openEn: 'Open Central Recipe',
  saveAndOpenTh: 'บันทึกแล้วไปที่สูตรกลาง',
  saveAndOpenEn: 'Save & Open Central Recipe',
  goWithoutSavingTh: 'ไปโดยไม่บันทึก',
  goWithoutSavingEn: 'Leave Without Saving',
  stayTh: 'อยู่ต่อ',
  stayEn: 'Stay Here',
  unresolvedHintTh:
    'ยังไม่พบสูตรกลางที่เชื่อมกับตัวเลือกนี้ กรุณาเชื่อมข้อมูลจากต้นทุนอาหารก่อน',
  unresolvedHintEn:
    'No central recipe linked to this option yet. Please link it from Food Cost first.',
} as const;

export function getCentralRecipeOriginLabel(
  origin: CentralRecipeOriginPage | null | undefined,
  lang: 'th' | 'en' = 'th'
): string {
  switch (origin) {
    case 'menu_cost':
      return lang === 'en' ? 'Menu Management' : 'จัดการเมนู';
    case 'pos':
      return lang === 'en' ? 'Tables / POS' : 'โต๊ะ / จุดขาย (POS)';
    case 'cost_food_cost_alacarte':
      return lang === 'en'
        ? 'Food Cost / Menu (A La Carte)'
        : 'ต้นทุนอาหาร / เมนู (กับข้าว)';
    case 'cost_food_cost':
      return lang === 'en' ? 'Food Cost / Menu' : 'ต้นทุนอาหาร / เมนู';
    default:
      return '';
  }
}

/**
 * Resolve an active central MenuItem (and optional active MenuVariant) from a navigation target.
 * Prefers matching `variantId` on an active variant inside an active menu, then falls back to `menuId`.
 */
export function resolveCentralRecipeMenuTarget(
  menus: MenuItem[],
  target: { variantId?: string; menuId?: string } | null | undefined
): { menu: MenuItem; variant?: MenuVariant } | null {
  if (!target || !Array.isArray(menus) || menus.length === 0) return null;

  const activeMenus = menus.filter((m) => m.active !== false);

  if (target.variantId) {
    for (const m of activeMenus) {
      const matchedVar = (m.variants || []).find(
        (v) => v.id === target.variantId && v.active !== false
      );
      if (matchedVar) {
        return { menu: m, variant: matchedVar };
      }
    }
  }

  if (target.menuId) {
    const matchedMenu = activeMenus.find((m) => m.id === target.menuId);
    if (matchedMenu) {
      return { menu: matchedMenu };
    }
  }

  return null;
}
