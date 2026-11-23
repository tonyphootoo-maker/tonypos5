/**
 * Deterministic offline Thai -> English culinary translator.
 * Produces authentic food-industry English terminology without phonetic karaoke romanization.
 * Resolution order (Phase 1):
 *   1. Manual edit / shop glossary override
 *   2. Exact dictionary match after normalization
 *   3. Safe culinary pattern rules / 100%-coverage segmentation
 *   4. Unresolved -> empty string with needsReview: true (never emits partial or romanized Thai)
 */

export type TranslationSource =
  | 'manual'
  | 'glossary'
  | 'dictionary'
  | 'pattern'
  | 'ai'
  | 'none';

export type TranslationConfidence = 'high' | 'medium' | 'low';

export interface TranslateMenuNameResult {
  en: string;
  source: TranslationSource;
  confidence: TranslationConfidence;
  needsReview: boolean;
}

export interface TranslateMenuNameOptions {
  glossary?: Record<string, string>;
  manualEnglish?: string;
  isManuallyEdited?: boolean;
}

export const HAS_THAI_RE = /[\u0E00-\u0E7F]/;

export function containsThaiCharacters(value: string | null | undefined): boolean {
  return Boolean(value && HAS_THAI_RE.test(value));
}

const ZERO_WIDTH_AND_SOFT_HYPHEN_RE = /[\u200B-\u200D\uFEFF\u00AD]/g;

/**
 * R3: Normalize Thai text consistently before glossary, dictionary, pattern, or AI lookup.
 * - Strips zero-width characters & soft hyphens
 * - Applies Unicode NFC
 * - Reconstructs decomposed Sara Am (\u0E4D\u0E32 -> \u0E33, preserving any tone mark before it)
 * - Trims & collapses repeated whitespace
 * - Unifies common culinary spelling variants (ปอเปี๊ยะ, กะเพรา, ก๋วยเตี๋ยว, ไส้กรอก)
 * - Handles ๆ cleanly (preserves อื่นๆ/อื่น ๆ as อื่นๆ; strips trailing emphasis ๆ)
 */
export function normalizeThaiForTranslation(input: string): string {
  if (!input) return '';

  let text = input
    .replace(ZERO_WIDTH_AND_SOFT_HYPHEN_RE, '')
    .normalize('NFC')
    // Decomposed Sara Am forms (e.g. น + ้ + ํ + า -> น้ำ)
    .replace(/([\u0E48-\u0E4B]?)\u0E4D\u0E32/g, '$1\u0E33')
    .replace(/\u0E4D([\u0E48-\u0E4B])\u0E32/g, '$1\u0E33')
    .replace(/\s+/g, ' ')
    .trim();

  // Unify common Thai menu spelling variants
  text = text
    .replace(/(?:เปาะเปี๊ยะ|ปอเปี๊ยะ|เปาะเปียะ|ปอเปียะ|ปอเปี๊ย|เปาะเปี๊ย|ปอเปี้ย|เปาะเปี้ย)/g, 'ปอเปี๊ยะ')
    .replace(/(?:กระเพรา|กระเพราะ|กะเพราะ)/g, 'กะเพรา')
    .replace(/(?:ก๊วยเตี๋ยว|ก๋วยเตียว)/g, 'ก๋วยเตี๋ยว')
    .replace(/ใส้กรอก/g, 'ไส้กรอก')
    .replace(/(?:บร็อคโคลี่|บรอคโคลี่)/g, 'บล็อกโคลี่');

  // Preserve "อื่นๆ" / "อื่น ๆ" cleanly, while stripping emphasis "ๆ" (e.g. "สดๆ" / "ร้อน ๆ")
  const OTHER_SENTINEL = '__TONYS_OTHER_TH__';
  text = text.replace(/อื่น\s*ๆ/g, OTHER_SENTINEL);
  text = text.replace(/\s*ๆ+/g, '');
  text = text.replace(new RegExp(OTHER_SENTINEL, 'g'), 'อื่นๆ');

  return text.replace(/\s+/g, ' ').trim();
}

// ============================================================================
// Shop Glossary Store (Safe in both Browser and Node/Vitest environments)
// ============================================================================
const GLOSSARY_STORAGE_KEY = 'tonys_shop_translation_glossary_v1';
let inMemoryGlossary: Record<string, string> = {};
type GlossaryChangeListener = (entries: Record<string, string>) => void;
const glossaryListeners = new Set<GlossaryChangeListener>();

function notifyGlossaryListeners(snapshot: Record<string, string>): void {
  const copy = { ...snapshot };
  for (const listener of glossaryListeners) {
    try {
      listener(copy);
    } catch {
      // Ignore subscriber errors so dictionary updates never fail
    }
  }
}

export function subscribeShopTranslationGlossary(
  listener: GlossaryChangeListener
): () => void {
  glossaryListeners.add(listener);
  return () => {
    glossaryListeners.delete(listener);
  };
}

function sanitizeGlossaryEntries(entries: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries || {})) {
    const normKey = normalizeThaiForTranslation(k);
    const val = (v || '').trim();
    if (normKey && HAS_THAI_RE.test(normKey) && val && !HAS_THAI_RE.test(val)) {
      cleaned[normKey] = val;
    }
  }
  return cleaned;
}

function readBrowserGlossary(): Record<string, string> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GLOSSARY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Ignore storage read failures in private/test environments
  }
  return null;
}

function writeBrowserGlossary(next: Record<string, string>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GLOSSARY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write failures
  }
}

export function getShopTranslationGlossary(): Record<string, string> {
  const fromStorage = readBrowserGlossary();
  if (fromStorage) {
    inMemoryGlossary = { ...fromStorage, ...inMemoryGlossary };
  }
  return { ...inMemoryGlossary };
}

export function setShopTranslationGlossary(entries: Record<string, string>): void {
  const cleaned = sanitizeGlossaryEntries(entries);
  inMemoryGlossary = cleaned;
  writeBrowserGlossary(cleaned);
  notifyGlossaryListeners(cleaned);
}

export function mergeShopTranslationGlossary(
  entries: Record<string, string>,
  options: { replace?: boolean; notify?: boolean } = {}
): Record<string, string> {
  const { replace = false, notify = false } = options;
  const cleanedIncoming = sanitizeGlossaryEntries(entries);
  const next = replace
    ? cleanedIncoming
    : { ...getShopTranslationGlossary(), ...cleanedIncoming };
  inMemoryGlossary = next;
  writeBrowserGlossary(next);
  if (notify) {
    notifyGlossaryListeners(next);
  }
  return { ...next };
}

export function upsertShopTranslationEntry(thaiTerm: string, englishTerm: string): void {
  const normKey = normalizeThaiForTranslation(thaiTerm);
  const val = (englishTerm || '').trim();
  if (!normKey || !val || HAS_THAI_RE.test(val)) return;
  const current = getShopTranslationGlossary();
  if (current[normKey] === val) return;
  current[normKey] = val;
  inMemoryGlossary = current;
  writeBrowserGlossary(current);
  notifyGlossaryListeners(current);
}

export function removeShopTranslationEntry(thaiTerm: string): void {
  const normKey = normalizeThaiForTranslation(thaiTerm);
  if (!normKey) return;
  const current = getShopTranslationGlossary();
  if (!(normKey in current)) return;
  delete current[normKey];
  inMemoryGlossary = current;
  writeBrowserGlossary(current);
  notifyGlossaryListeners(current);
}

export function clearShopTranslationGlossary(): void {
  inMemoryGlossary = {};
  writeBrowserGlossary({});
  notifyGlossaryListeners({});
}

// ============================================================================
// Culinary Dictionaries
// ============================================================================
const PHRASE_DICTIONARY: Array<[string, string]> = [
  // Multi-word dishes & preparations (longest first)
  ['ผัดกะเพราหมูกรอบ', 'Stir-Fried Holy Basil with Crispy Pork'],
  ['ผัดกะเพราหมูสับ', 'Stir-Fried Holy Basil with Minced Pork'],
  ['ผัดกะเพราหมูบด', 'Stir-Fried Holy Basil with Minced Pork'],
  ['ผัดกะเพราหมูหมัก', 'Stir-Fried Holy Basil with Marinated Pork'],
  ['ผัดกะเพราหมูชิ้น', 'Stir-Fried Holy Basil with Sliced Pork'],
  ['ผัดกะเพราไก่', 'Stir-Fried Holy Basil with Chicken'],
  ['ผัดกะเพราเนื้อสับ', 'Stir-Fried Holy Basil with Minced Beef'],
  ['ผัดกะเพราเนื้อ', 'Stir-Fried Holy Basil with Beef'],
  ['ผัดกะเพรากุ้ง', 'Stir-Fried Holy Basil with Shrimp'],
  ['ผัดกะเพราปลาหมึก', 'Stir-Fried Holy Basil with Squid'],
  ['ผัดกะเพราทะเล', 'Stir-Fried Holy Basil with Seafood'],
  ['ผัดกะเพราไข่เยี่ยวม้า', 'Stir-Fried Holy Basil with Century Egg'],
  ['ผัดกะเพราคลุกข้าว', 'Holy Basil Mixed Fried Rice'],
  ['ข้าวกะเพราหมูสับไข่ดาว', 'Stir-Fried Holy Basil Minced Pork & Fried Egg on Rice'],
  ['ข้าวกะเพราหมูสับ', 'Stir-Fried Holy Basil Minced Pork on Rice'],
  ['ข้าวกะเพราหมูกรอบ', 'Stir-Fried Holy Basil Crispy Pork on Rice'],
  ['ข้าวกะเพราราดข้าว', 'Stir-Fried Holy Basil with Rice'],
  ['ข้าวกะเพรา', 'Stir-Fried Holy Basil on Rice'],
  ['กะเพราโบราณ', 'Classic Stir-Fried Holy Basil'],
  ['กะเพราหมูกรอบ', 'Holy Basil Crispy Pork'],
  ['กะเพราหมูสับ', 'Holy Basil Minced Pork'],
  ['กะเพราหมูบด', 'Holy Basil Minced Pork'],
  ['กะเพราหมูหมัก', 'Holy Basil Marinated Pork'],
  ['กะเพราหมูชิ้น', 'Holy Basil Sliced Pork'],
  ['กะเพราไก่', 'Holy Basil Chicken'],
  ['กะเพราเนื้อสับ', 'Holy Basil Minced Beef'],
  ['กะเพราเนื้อ', 'Holy Basil Beef'],
  ['กะเพรากุ้ง', 'Holy Basil Shrimp'],
  ['กะเพราปลาหมึก', 'Holy Basil Squid'],
  ['กะเพราทะเล', 'Holy Basil Seafood'],
  ['ผัดกะเพรา', 'Stir-Fried Holy Basil'],
  ['ข้าวผัดกะเพรา', 'Holy Basil Fried Rice'],
  ['ข้าวผัดปู', 'Crab Fried Rice'],
  ['ข้าวผัดกุ้ง', 'Shrimp Fried Rice'],
  ['ข้าวผัดหมู', 'Pork Fried Rice'],
  ['ข้าวผัดไก่', 'Chicken Fried Rice'],
  ['ข้าวผัดทะเล', 'Seafood Fried Rice'],
  ['ข้าวผัดอเมริกัน', 'American Fried Rice'],
  ['ข้าวผัดต้มยำ', 'Tom Yum Fried Rice'],
  ['ข้าวผัดปลาเค็ม', 'Salted Fish Fried Rice'],
  ['ข้าวผัดกุนเชียง', 'Chinese Sausage Fried Rice'],
  ['ข้าวผัดแหนม', 'Fermented Pork Fried Rice'],
  ['ข้าวผัดไข่', 'Egg Fried Rice'],
  ['ข้าวผัดสับปะรด', 'Pineapple Fried Rice'],
  ['ข้าวผัด', 'Fried Rice'],
  ['ต้มยำกุ้งน้ำข้น', 'Creamy Tom Yum Kung'],
  ['ต้มยำกุ้งน้ำใส', 'Clear Tom Yum Kung'],
  ['ต้มยำกุ้ง', 'Tom Yum Kung'],
  ['ต้มยำทะเล', 'Seafood Tom Yum'],
  ['ต้มยำรวมมิตร', 'Mixed Tom Yum'],
  ['ต้มยำไก่', 'Chicken Tom Yum'],
  ['ต้มยำปลา', 'Fish Tom Yum'],
  ['ต้มยำ', 'Tom Yum'],
  ['ต้มข่าไก่', 'Tom Kha Gai'],
  ['ต้มข่า', 'Coconut Galangal Soup'],
  ['ต้มแซ่บกระดูกอ่อน', 'Spicy Pork Cartilage Soup'],
  ['ต้มแซ่บกระดูกหมู', 'Spicy Pork Rib Soup'],
  ['ต้มแซ่บ', 'Isaan Spicy Herb Soup'],
  ['ต้มโคล้งปลากรอบ', 'Spicy Smoky Crispy Fish Soup'],
  ['ต้มโคล้ง', 'Spicy Smoky Herb Soup'],
  ['ต้มเล้ง', 'Spicy Pork Spine Soup'],
  ['ต้มจืดเต้าหู้หมูสับ', 'Clear Tofu & Minced Pork Soup'],
  ['ต้มจืดตำลึงหมูสับ', 'Clear Ivy Gourd & Minced Pork Soup'],
  ['ต้มจับฉ่าย', 'Braised Mixed Vegetable Stew'],
  ['แกงจืด', 'Clear Soup'],
  ['ต้มจืด', 'Clear Soup'],
  ['แกงเขียวหวานไก่', 'Chicken Green Curry'],
  ['แกงเขียวหวานหมู', 'Pork Green Curry'],
  ['แกงเขียวหวานเนื้อ', 'Beef Green Curry'],
  ['แกงเขียวหวานลูกชิ้นปลากราย', 'Clown Featherback Fish Ball Green Curry'],
  ['แกงเขียวหวาน', 'Green Curry'],
  ['แกงแดง', 'Red Curry'],
  ['แกงเผ็ดเป็ดย่าง', 'Roasted Duck Red Curry'],
  ['แกงเผ็ด', 'Red Curry'],
  ['แกงพะแนงหมู', 'Pork Panang Curry'],
  ['แกงพะแนงไก่', 'Chicken Panang Curry'],
  ['แกงพะแนงเนื้อ', 'Beef Panang Curry'],
  ['แกงพะแนง', 'Panang Curry'],
  ['พะแนง', 'Panang Curry'],
  ['แกงมัสมั่นไก่', 'Chicken Massaman Curry'],
  ['แกงมัสมั่นเนื้อ', 'Beef Massaman Curry'],
  ['แกงมัสมั่น', 'Massaman Curry'],
  ['มัสมั่น', 'Massaman Curry'],
  ['แกงส้มชะอมไข่', 'Sour Curry with Acacia Omelette'],
  ['แกงส้มผักรวม', 'Sour Curry with Mixed Vegetables'],
  ['แกงส้ม', 'Sour Curry'],
  ['แกงป่า', 'Jungle Curry'],
  ['แกงคั่วหอยขม', 'Roasted Red Curry with River Snails'],
  ['แกงคั่ว', 'Roasted Red Curry'],
  ['แกงเหลือง', 'Southern Yellow Curry'],
  ['คั่วกลิ้งหมูสับ', 'Southern Dry-Fried Spicy Minced Pork'],
  ['คั่วกลิ้ง', 'Southern Dry-Fried Spicy Curry'],
  ['ฉู่ฉี่กุ้ง', 'Shrimp in Creamy Red Curry Sauce'],
  ['ฉู่ฉี่ปลาทู', 'Mackerel in Creamy Red Curry Sauce'],
  ['ฉู่ฉี่', 'Choo Chee Red Curry'],
  ['พะโล้', 'Five-Spice Braised'],
  ['ไข่พะโล้', 'Five-Spice Braised Pork & Egg'],
  ['ผัดไทยกุ้งสด', 'Pad Thai with Fresh Shrimp'],
  ['ผัดไทยเส้นจันท์', 'Chanthaburi-Noodle Pad Thai'],
  ['ผัดไทย จันท์', 'Chanthaburi Pad Thai'],
  ['ผัดไทย', 'Pad Thai'],
  ['ผัดซีอิ๊ว', 'Pad See Ew'],
  ['ราดหน้า', 'Stir-Fried Noodles in Gravy'],
  ['สุกี้แห้งหมูหมัก', 'Dry Sukiyaki with Marinated Pork'],
  ['สุกี้แห้ง', 'Dry Sukiyaki'],
  ['สุกี้น้ำ', 'Sukiyaki Soup'],
  ['สุกี้', 'Sukiyaki'],
  ['คะน้าหมูกรอบ', 'Stir-Fried Chinese Kale with Crispy Pork'],
  ['คะน้าน้ำมันหอย', 'Stir-Fried Chinese Kale in Oyster Sauce'],
  ['ผัดพริกแกงถั่วฝักยาว', 'Stir-Fried Red Curry Paste with Yardlong Beans'],
  ['ผัดพริกแกง', 'Stir-Fried Red Curry Paste'],
  ['พริกแกงเขียวหวาน', 'Green Curry Paste'],
  ['พริกแกงเผ็ด', 'Red Curry Paste'],
  ['พริกแกงส้ม', 'Sour Curry Paste'],
  ['พริกแกงมัสมั่น', 'Massaman Curry Paste'],
  ['พริกแกงพะแนง', 'Panang Curry Paste'],
  ['พริกแกง', 'Curry Paste'],
  ['ผัดพริกเผา', 'Stir-Fried Roasted Chili Paste'],
  ['ผัดผงกะหรี่', 'Stir-Fried Curry Powder'],
  ['ปูผัดผงกะหรี่', 'Stir-Fried Crab in Curry Powder'],
  ['ทะเลผัดผงกะหรี่', 'Stir-Fried Seafood in Curry Powder'],
  ['คั่วพริกเกลือ', 'Stir-Fried with Chili & Salt'],
  ['ผัดขิง', 'Stir-Fried with Ginger'],
  ['ไก่ผัดเม็ดมะม่วงหิมพานต์', 'Stir-Fried Chicken with Cashew Nuts'],
  ['ผัดเม็ดมะม่วงหิมพานต์', 'Stir-Fried with Cashew Nuts'],
  ['ผัดหน่อไม้', 'Stir-Fried with Bamboo Shoots'],
  ['ผัดพริกขี้หนู', "Stir-Fried with Bird's Eye Chili"],
  ['ทอดกระเทียมพริกไทย', 'Fried Garlic & Pepper'],
  ['ทอดกระเทียม', 'Fried Garlic'],
  ['ผัดกระเทียม', 'Stir-Fried Garlic'],
  ['ผัดน้ำมันหอย', 'Stir-Fried Oyster Sauce'],
  ['ผัดผักรวมมิตร', 'Stir-Fried Mixed Vegetables'],
  ['ผัดผักรวม', 'Stir-Fried Mixed Vegetables'],
  ['ผัดผัก', 'Stir-Fried Vegetables'],
  ['ผักรวม', 'Mixed Vegetables'],
  ['ผักลวก', 'Blanched Vegetables'],
  ['ผักทอด', 'Fried Vegetables'],
  ['ผักสด', 'Fresh Vegetables'],
  ['เห็ดทอด', 'Fried Mushrooms'],
  ['กะหล่ำปลีทอดน้ำปลา', 'Stir-Fried Cabbage with Fish Sauce'],
  ['ผัดยอดมะระหวาน', 'Stir-Fried Chayote Shoots'],
  ['ผัดต้นหอม', 'Stir-Fried with Spring Onions'],
  ['ข้าวไข่เจียวหมูสับ', 'Minced Pork Omelette on Rice'],
  ['ข้าวไข่เจียว', 'Omelette on Rice'],
  ['ข้าวหมูแดง', 'BBQ Pork Rice'],
  ['ข้าวหมูกรอบ', 'Crispy Pork Rice'],
  ['ข้าวมันไก่ทอด', 'Crispy Fried Chicken Rice'],
  ['ข้าวมันไก่', 'Hainanese Chicken Rice'],
  ['ข้าวขาหมู', 'Braised Pork Leg Rice'],
  ['ข้าวหมูกระเทียม', 'Garlic Pork Rice'],
  ['ข้าวคลุกกะปิ', 'Shrimp Paste Fried Rice'],
  ['ข้าวสวยหอมมะลิ', 'Steamed Jasmine Rice'],
  ['ข้าวสวย', 'Steamed Rice'],
  ['ข้าวเปล่า', 'Steamed Rice'],
  ['ข้าวเหนียว', 'Sticky Rice'],
  ['ข้าวต้มกุ๊ย', 'Plain Rice Congee'],
  ['ข้าวต้มปลา', 'Fish Rice Soup'],
  ['ข้าวต้มหมู', 'Pork Rice Soup'],
  ['ข้าวต้ม', 'Boiled Rice Soup'],
  ['โจ๊กหมูใส่ไข่', 'Pork Rice Porridge with Egg'],
  ['โจ๊ก', 'Rice Porridge'],
  ['ก๋วยเตี๋ยวต้มยำ', 'Tom Yum Noodle Soup'],
  ['ก๋วยเตี๋ยวน้ำตก', 'Boat Noodles'],
  ['ก๋วยเตี๋ยวน้ำใส', 'Clear Broth Noodle Soup'],
  ['ก๋วยเตี๋ยวแห้ง', 'Dry Noodles'],
  ['ก๋วยเตี๋ยวคั่วไก่', 'Stir-Fried Rice Noodles with Chicken'],
  ['ก๋วยเตี๋ยว', 'Noodles'],
  ['ก๋วยจั๊บญวน', 'Vietnamese Rice Noodle Soup'],
  ['ก๋วยจั๊บ', 'Rolled Rice Noodle Soup'],
  ['เกาเหลา', 'Clear Broth Meat & Veg Bowl'],
  ['ขนมจีนน้ำยา', 'Fermented Rice Noodles with Fish Curry'],
  ['ขนมจีนแกงเขียวหวาน', 'Fermented Rice Noodles with Green Curry'],
  ['ขนมจีน', 'Fermented Rice Noodles'],
  ['มาม่าผัดขี้เมา', 'Drunken Stir-Fried Instant Noodles'],
  ['ผัดขี้เมา', 'Spicy Drunken Stir-Fry'],
  ['ผัดฉ่า', 'Sizzling Spicy Herb Stir-Fry'],
  ['ผัดพริกหยวก', 'Stir-Fried Bell Pepper'],
  ['ผัดเปรี้ยวหวาน', 'Sweet & Sour Stir-Fry'],
  ['ผัดผักบุ้งไฟแดง', 'Stir-Fried Morning Glory'],
  ['ส้มตำไทย', 'Thai Papaya Salad'],
  ['ส้มตำปูปลาร้า', 'Papaya Salad with Fermented Fish'],
  ['ส้มตำข้าวโพด', 'Spicy Corn Salad'],
  ['ส้มตำ', 'Papaya Salad'],
  ['คอหมูย่าง', 'Grilled Pork Neck'],
  ['เสือร้องไห้', 'Grilled Beef Brisket'],
  ['น้ำตกคอหมูย่าง', 'Spicy Grilled Pork Neck Waterfall Salad'],
  ['น้ำตกหมู', 'Grilled Pork Waterfall Salad'],
  ['น้ำตกเนื้อ', 'Grilled Beef Waterfall Salad'],
  ['ลาบเป็ด', 'Spicy Minced Duck Salad (Larb)'],
  ['ลาบหมู', 'Spicy Minced Pork Salad (Larb)'],
  ['ลาบไก่', 'Spicy Minced Chicken Salad (Larb)'],
  ['ลาบเนื้อ', 'Spicy Minced Beef Salad (Larb)'],
  ['ลาบวุ้นเส้น', 'Spicy Glass Noodle Salad (Larb)'],
  ['ลาบ', 'Spicy Salad (Larb)'],
  ['พล่ากุ้ง', 'Spicy Lemongrass Shrimp Salad'],
  ['ยำคอหมูย่าง', 'Spicy Grilled Pork Neck Salad'],
  ['ยำปลากระป๋อง', 'Spicy Canned Sardine Salad'],
  ['ยำวุ้นเส้น', 'Glass Noodle Spicy Salad'],
  ['ยำมาม่า', 'Instant Noodle Spicy Salad'],
  ['ยำทะเล', 'Seafood Spicy Salad'],
  ['ยำไข่ดาว', 'Crispy Fried Egg Spicy Salad'],
  ['ยำหมูยอ', 'Vietnamese Pork Sausage Salad'],
  ['ยำหมูย่าง', 'Spicy Grilled Pork Salad'],
  ['ปีกไก่ทอดน้ำปลา', 'Crispy Chicken Wings with Fish Sauce'],
  ['ปีกไก่ทอด', 'Fried Chicken Wings'],
  ['ไก่ทอดหาดใหญ่', 'Hat Yai Crispy Fried Chicken'],
  ['ไก่ทอด', 'Fried Chicken'],
  ['ไก่ย่าง', 'Grilled Chicken'],
  ['หมูทอดกระเทียม', 'Fried Garlic Pork'],
  ['หมูสามชั้นทอดน้ำปลา', 'Deep-Fried Pork Belly with Fish Sauce'],
  ['หมูแดดเดียว', 'Sun-Dried Fried Pork'],
  ['หมูทอด', 'Fried Pork'],
  ['หมูย่าง', 'Grilled Pork'],
  ['หมูปิ้ง', 'Grilled Pork Skewers (Moo Ping)'],
  ['เป็ดย่าง', 'Roasted Duck'],
  ['ปลาดุกฟู', 'Crispy Flaked Catfish Salad'],
  ['ทอดมันปลา', 'Thai Fish Cakes (Tod Mun Pla)'],
  ['ทอดมันกุ้ง', 'Thai Shrimp Cakes (Tod Mun Kung)'],
  ['กุ้งทอด', 'Fried Shrimp'],
  ['ปลาทอด', 'Fried Fish'],
  ['เต้าหู้ทอด', 'Fried Tofu'],
  ['ไส้กรอกทอด', 'Fried Sausage'],
  ['ลูกชิ้นทอด', 'Fried Meatballs'],
  ['ไข่เจียวหมูสับ', 'Minced Pork Omelette'],
  ['ไข่เจียวปู', 'Crab Omelette'],
  ['ไข่เจียวกุ้งสับ', 'Minced Shrimp Omelette'],
  ['ไข่เจียวสมุนไพร', 'Herb Omelette'],
  ['ข้าวไข่ข้น', 'Creamy Omelette on Rice'],
  ['หมูผัดกะปิ', 'Stir-Fried Pork with Shrimp Paste'],
  ['ปลาหมึกผัดไข่เค็ม', 'Stir-Fried Squid with Salted Egg'],
  ['กุ้งอบวุ้นเส้น', 'Baked Shrimp with Glass Noodles'],
  ['หมึกนึ่งมะนาว', 'Steamed Squid in Spicy Lime Sauce'],
  ['ปลากะพงนึ่งมะนาว', 'Steamed Sea Bass in Spicy Lime Sauce'],
  ['ปลากะพงทอดน้ำปลา', 'Deep-Fried Sea Bass with Fish Sauce'],
  ['สเต็กอกไก่พริกไทยดำ', 'Black Pepper Chicken Breast Steak'],
  ['สเต็กปลาแซลมอน', 'Grilled Salmon Steak'],
  ['สเต็กหมู', 'Pork Steak'],
  ['สเต็กไก่', 'Chicken Steak'],
  ['สเต็กเนื้อ', 'Beef Steak'],
  ['เฟรนช์ฟรายส์ชีส', 'Cheesy French Fries'],
  ['เฟรนช์ฟรายส์', 'French Fries'],
  ['นักเก็ตไก่', 'Chicken Nuggets'],
  ['เกี๊ยวทอด', 'Fried Wontons'],
  ['เกี๊ยวกรอบ', 'Crispy Wontons'],
  ['เกี๊ยวหมู', 'Pork Wontons'],
  ['เกี๊ยว', 'Wontons'],
  ['ขนมจีบ', 'Steamed Dumplings (Kanom Jeeb)'],
  ['ซาลาเปา', 'Steamed Buns'],
  ['ปอเปี๊ยะผักทอด', 'Fried Vegetable Spring Rolls'],
  ['ปอเปี๊ยะกุ้งสด', 'Fresh Shrimp Spring Rolls'],
  ['ปอเปี๊ยะไส้ผัก', 'Vegetable Spring Rolls'],
  ['ปอเปี๊ยะผัก', 'Vegetable Spring Rolls'],
  ['ปอเปี๊ยะกุ้ง', 'Shrimp Spring Rolls'],
  ['ปอเปี๊ยะหมู', 'Pork Spring Rolls'],
  ['ปอเปี๊ยะทอด', 'Fried Spring Rolls'],
  ['ปอเปี๊ยะสด', 'Fresh Spring Rolls'],
  ['ปอเปี๊ยะ', 'Spring Rolls'],

  // Beverages & Desserts
  ['ชาไทยเย็น', 'Thai Iced Tea'],
  ['ชาไทย', 'Thai Tea'],
  ['ชาเย็น', 'Thai Iced Tea'],
  ['ชาเขียวเย็น', 'Iced Green Tea'],
  ['ชาเขียว', 'Green Tea'],
  ['ชานมไข่มุก', 'Bubble Milk Tea'],
  ['ชานม', 'Milk Tea'],
  ['ชามะนาว', 'Iced Lemon Tea'],
  ['ชาดำเย็น', 'Iced Black Tea'],
  ['โอเลี้ยง', 'Thai Iced Black Coffee'],
  ['กาแฟเย็น', 'Iced Coffee'],
  ['กาแฟร้อน', 'Hot Coffee'],
  ['เอสเปรสโซ่เย็น', 'Iced Espresso'],
  ['อเมริกาโน่เย็น', 'Iced Americano'],
  ['อเมริกาโน่', 'Americano'],
  ['ลาเต้เย็น', 'Iced Latte'],
  ['คาปูชิโน่', 'Cappuccino'],
  ['มอคค่า', 'Mocha'],
  ['โกโก้เย็น', 'Iced Cocoa'],
  ['นมสดปั่น', 'Fresh Milk Smoothie'],
  ['นมเย็น', 'Iced Pink Milk'],
  ['น้ำมะนาว', 'Fresh Lime Juice'],
  ['น้ำส้มคั้น', 'Fresh Orange Juice'],
  ['น้ำเก๊กฮวย', 'Chrysanthemum Tea'],
  ['น้ำกระเจี๊ยบ', 'Roselle Juice'],
  ['น้ำลำไย', 'Longan Juice'],
  ['น้ำอัดลม', 'Soft Drink'],
  ['น้ำดื่ม', 'Drinking Water'],
  ['น้ำแข็ง', 'Ice'],
  ['ข้าวเหนียวมะม่วง', 'Mango Sticky Rice'],
  ['ทับทิมกรอบ', 'Water Chestnuts in Coconut Milk'],
  ['บัวลอย', 'Glutinous Rice Balls in Coconut Milk'],
  ['ไอศกรีมกะทิ', 'Coconut Ice Cream'],
  ['ไอศกรีม', 'Ice Cream'],

  // Option Groups & Common Choices
  ['ระดับความเผ็ด', 'Spice Level'],
  ['ความเผ็ด', 'Spice Level'],
  ['เผ็ดน้อย', 'Mild Spicy'],
  ['เผ็ดกลาง', 'Medium Spicy'],
  ['เผ็ดมาก', 'Very Spicy'],
  ['เผ็ดพิเศษ', 'Extra Spicy'],
  ['ไม่เผ็ด', 'Non-Spicy'],
  ['พริกน้ำปลาแท้ (ถ้วยแยก)', 'Chili Fish Sauce (Side Cup)'],
  ['พริกน้ำปลา', 'Chili Fish Sauce'],
  ['แตงกวาหั่นชิ้นเคียง', 'Sliced Cucumber Garnish'],
  ['มะนาวฝานซีก', 'Fresh Lime Wedge'],
  ['ผักเคียง / ต้นหอมผักชี', 'Fresh Side Herbs / Spring Onion & Coriander'],
  ['ท็อปปิ้ง', 'Toppings'],
  ['เครื่องเคียง', 'Side Dishes'],
  ['เพิ่มไข่', 'Add Egg'],
  ['ไข่ดาวไม่สุก', 'Sunny-Side Up Fried Egg'],
  ['ไข่ดาวสุก', 'Well-Done Fried Egg'],
  ['ไข่ดาวเป็ด/ไก่', 'Duck / Chicken Fried Egg'],
  ['ไข่ดาวกรอบ', 'Crispy Fried Egg'],
  ['ไข่ดาว / ไข่เจียว', 'Fried Egg / Omelette'],
  ['ไข่ดาว', 'Fried Egg'],
  ['ไข่เจียว', 'Omelette'],
  ['ไข่ข้น', 'Creamy Omelette'],
  ['ไข่ต้ม', 'Boiled Egg'],
  ['ไข่ลวก', 'Soft-Boiled Egg'],
  ['ไข่เยี่ยวม้า', 'Century Egg'],
  ['ไข่เค็ม', 'Salted Egg'],
  ['เพิ่มข้าว', 'Extra Rice'],
  ['เพิ่มเนื้อ', 'Extra Meat'],
  ['ไม่ใส่ผัก', 'No Vegetables'],
  ['ไม่ใส่กระเทียม', 'No Garlic'],
  ['ไม่ใส่พริก', 'No Chili'],
  ['ไม่ใส่ผงชูรส', 'No MSG'],
  ['ไม่ใส่ต้นหอม', 'No Spring Onion'],
  ['ไม่ใส่ถั่วงอก', 'No Bean Sprouts'],
  ['แยกน้ำ', 'Sauce on the Side'],
  ['แยกซอส', 'Sauce on the Side'],
  ['แยกกับ', 'Separate Dish'],
  ['แยกข้าว', 'Separate Rice'],
  ['ระดับความหวาน', 'Sweetness Level'],
  ['ไม่หวาน', 'Unsweetened'],
  ['หวานน้อย', 'Less Sweet'],
  ['หวานปกติ', 'Normal Sweet'],
  ['หวานมาก', 'Extra Sweet'],
  ['ความสุก', 'Doneness'],
  ['สุกมาก', 'Well Done'],
  ['กึ่งสุกกึ่งดิบ', 'Medium Rare'],
  ['เลือกเส้น', 'Noodle Type'],
  ['เส้นใหญ่', 'Wide Rice Noodles'],
  ['เส้นเล็ก', 'Thin Rice Noodles'],
  ['เส้นหมี่ขาว', 'Rice Vermicelli'],
  ['เส้นหมี่', 'Rice Vermicelli'],
  ['เส้นจันท์แช่น้ำ', 'Soaked Chanthaburi Rice Noodles'],
  ['เส้นจันท์', 'Chanthaburi Rice Noodles'],
  ['วุ้นเส้นแช่น้ำ', 'Soaked Glass Noodles'],
  ['วุ้นเส้น', 'Glass Noodles'],
  ['บะหมี่เหลือง', 'Egg Noodles'],
  ['บะหมี่กึ่งสำเร็จรูป (มาม่าซอง)', 'Instant Noodles (Packet)'],
  ['บะหมี่กึ่งสำเร็จรูป', 'Instant Noodles'],
  ['บะหมี่', 'Egg Noodles'],
  ['มาม่า', 'Instant Noodles'],

  // Proteins / Cuts / Seafood
  ['หมูหมัก (สูตรทางร้าน)', 'House Marinated Pork'],
  ['หมูบด (สันนอกบดมันน้อย)', 'Lean Ground Pork Loin'],
  ['หมูหมัก', 'Marinated Pork'],
  ['หมูบด', 'Ground Pork'],
  ['หมูสับ', 'Minced Pork'],
  ['หมูกรอบ', 'Crispy Pork'],
  ['หมูชิ้น', 'Sliced Pork'],
  ['หมูสามชั้น', 'Pork Belly'],
  ['หมูสันใน', 'Pork Tenderloin'],
  ['สันในหมู', 'Pork Tenderloin'],
  ['หมูสันนอก', 'Pork Loin'],
  ['สันนอกหมู', 'Pork Loin'],
  ['สันคอหมู', 'Pork Collar'],
  ['คอหมู', 'Pork Neck'],
  ['ซี่โครงหมู', 'Pork Ribs'],
  ['กระดูกหมู', 'Pork Bones'],
  ['กระดูกอ่อน', 'Pork Soft Bone'],
  ['กากหมู', 'Crispy Pork Cracklings'],
  ['แคบหมู', 'Crispy Pork Rinds'],
  ['หมูเด้ง', 'Pork Paste'],
  ['หมูยอ', 'Vietnamese Pork Sausage'],
  ['กุนเชียง', 'Chinese Sweet Sausage'],
  ['ไส้กรอกอีสาน', 'Isaan Fermented Pork Sausage'],
  ['หมูหยอง', 'Pork Floss'],
  ['หมูแผ่น', 'Crispy Pork Sheet'],
  ['เนื้อวัวโคขุน', 'Thai-French Beef'],
  ['เนื้อวัวสไลซ์', 'Sliced Beef'],
  ['เนื้อน่องลาย', 'Beef Shank'],
  ['เนื้อโคขุน', 'Premium Beef'],
  ['เนื้อสไลซ์', 'Sliced Beef'],
  ['เนื้อสับ', 'Minced Beef'],
  ['เนื้อเปื่อย', 'Braised Beef'],
  ['เนื้อตุ๋น', 'Stewed Beef'],
  ['เนื้อวัว', 'Beef'],
  ['อกไก่หั่นชิ้น', 'Sliced Chicken Breast'],
  ['อกไก่', 'Chicken Breast'],
  ['สะโพกไก่เลาะกระดูก', 'Boneless Chicken Thigh'],
  ['สะโพกไก่', 'Chicken Thigh'],
  ['น่องไก่', 'Chicken Drumstick'],
  ['ปีกไก่บน', 'Chicken Drumettes'],
  ['ปีกไก่กลาง', 'Chicken Mid-Wings'],
  ['ปีกไก่', 'Chicken Wings'],
  ['ตีนไก่', 'Chicken Feet'],
  ['ไก่บ้าน', 'Free-Range Chicken'],
  ['ไก่กรอบ', 'Crispy Chicken'],
  ['ไก่สับ', 'Minced Chicken'],
  ['ไก่ชิ้น', 'Sliced Chicken'],
  ['เนื้อไก่', 'Chicken'],
  ['กุ้งสด (XL)', 'Fresh Shrimp (XL)'],
  ['กุ้งสด', 'Fresh Shrimp'],
  ['กุ้งขาว', 'White Shrimp'],
  ['กุ้งแม่น้ำ', 'River Prawn'],
  ['กุ้งเด้ง', 'Bouncy Shrimp'],
  ['กุ้งแห้ง', 'Dried Shrimp'],
  ['ปลาหมึกกล้วยสด', 'Fresh Squid'],
  ['ปลาหมึกกล้วย', 'Squid'],
  ['ปลาหมึกกรอบ', 'Crispy Squid'],
  ['ปลาหมึก', 'Squid'],
  ['หมึกสด', 'Fresh Squid'],
  ['หมึกกรอบ', 'Crispy Squid'],
  ['หมึก', 'Squid'],
  ['ปลาดอลลี่', 'Dory Fish'],
  ['ปลากะพง', 'Sea Bass'],
  ['ปลาทับทิม', 'Red Tilapia'],
  ['ปลานิล', 'Tilapia'],
  ['ปลาดุก', 'Catfish'],
  ['ปลาทู', 'Mackerel'],
  ['ปลาอินทรีย์', 'King Mackerel'],
  ['ปลาเค็ม', 'Salted Fish'],
  ['ปลากรอบ', 'Crispy Dried Fish'],
  ['ปลากระป๋อง', 'Canned Sardines'],
  ['ปลาแซลมอน', 'Salmon'],
  ['เนื้อปลา', 'Fish Fillet'],
  ['เนื้อปูก้อน', 'Lump Crab Meat'],
  ['ปูม้า', 'Blue Swimming Crab'],
  ['ปูนิ่ม', 'Soft-Shell Crab'],
  ['ปูอัด', 'Crab Stick'],
  ['หอยแมลงภู่', 'Green Mussels'],
  ['หอยแครง', 'Blood Cockles'],
  ['หอยลาย', 'Short-Necked Clams'],
  ['หอยเชลล์', 'Scallops'],
  ['หอยนางรม', 'Oysters'],
  ['ทะเลรวม', 'Mixed Seafood'],
  ['รวมมิตรทะเล', 'Mixed Seafood'],
  ['ทะเล', 'Seafood'],
  ['รวมมิตร', 'Mixed'],
  ['ลูกชิ้นเอ็นเนื้อ', 'Beef Tendon Balls'],
  ['ลูกชิ้นหมู', 'Pork Balls'],
  ['ลูกชิ้นเนื้อ', 'Beef Balls'],
  ['ลูกชิ้นปลา', 'Fish Balls'],
  ['ลูกชิ้น', 'Meatballs'],
  ['เต้าหู้ไข่ไก่ (หลอด)', 'Egg Tofu (Tube)'],
  ['เต้าหู้ไข่', 'Egg Tofu'],
  ['เต้าหู้ขาว', 'Firm White Tofu'],
  ['เต้าหู้เหลือง', 'Yellow Tofu'],
  ['เต้าหู้', 'Tofu'],
  ['มังสวิรัติ', 'Vegetarian'],
  ['เบคอน', 'Bacon'],
  ['ไส้กรอก', 'Sausage'],
  ['แฮม', 'Ham'],

  // Sizes / Styles
  ['มาตรฐาน', 'Standard'],
  ['ธรรมดา', 'Regular'],
  ['พิเศษ', 'Special'],
  ['จัมโบ้', 'Jumbo'],
  ['ใหญ่', 'Large'],
  ['กลาง', 'Medium'],
  ['เล็ก', 'Small'],
  ['ราดข้าว', 'On Rice'],
  ['กับข้าว', 'A La Carte'],
  ['ใส่กล่อง', 'Takeaway Box'],

  // Sauces, Broths, Seasonings & Pantry
  ['ซอสผัดกระทะมาตรฐาน (สูตรประจำร้าน)', 'House Standard Stir-Fry Sauce'],
  ['ซอสผัดกระทะมาตรฐาน', 'House Standard Stir-Fry Sauce'],
  ['ซอสผัดกระทะ', 'Wok Stir-Fry Sauce'],
  ['ซอสผัด', 'Stir-Fry Sauce'],
  ['ซอสหอยนางรมตราแม่ครัว', 'Oyster Sauce (Maekrua)'],
  ['ซอสหอยนางรม', 'Oyster Sauce'],
  ['น้ำมันหอย', 'Oyster Sauce'],
  ['ซีอิ๊วขาวเห็ดหอม', 'Shiitake Light Soy Sauce'],
  ['ซีอิ๊วขาว', 'Light Soy Sauce'],
  ['ซีอิ๊วดำหวาน', 'Sweet Dark Soy Sauce'],
  ['ซีอิ๊วดำ', 'Dark Soy Sauce'],
  ['ซอสปรุงรสฝาเขียว', 'Green Cap Seasoning Sauce'],
  ['ซอสปรุงรส', 'Seasoning Sauce'],
  ['ซอสถั่วเหลือง', 'Soy Sauce'],
  ['ซอสสามรส', 'Three-Flavor Sweet & Sour Sauce'],
  ['น้ำปลาแท้ตราทิพรส', 'Fish Sauce (Tiparos)'],
  ['น้ำปลาแท้', 'Fish Sauce'],
  ['น้ำปลา', 'Fish Sauce'],
  ['น้ำปลาร้าต้มสุก', 'Pasteurized Fermented Fish Sauce'],
  ['น้ำปลาร้า', 'Fermented Fish Sauce'],
  ['เต้าเจี้ยว', 'Fermented Soybean Paste'],
  ['น้ำจิ้มสุกี้โบราณ', 'Traditional Suki Dipping Sauce'],
  ['น้ำจิ้มสุกี้', 'Suki Sauce'],
  ['น้ำจิ้มแจ่ว', 'Isaan Spicy Dipping Sauce'],
  ['น้ำจิ้มซีฟู้ด', 'Seafood Spicy Dipping Sauce'],
  ['น้ำจิ้มไก่', 'Sweet Chili Dipping Sauce'],
  ['น้ำจิ้มหมูกระทะ', 'Thai BBQ Dipping Sauce'],
  ['น้ำจิ้ม', 'Dipping Sauce'],
  ['น้ำซอสมะขามผัดไทย', 'Pad Thai Tamarind Sauce'],
  ['น้ำซอสมะขาม', 'Tamarind Sauce'],
  ['มะขามเปียกแกะเมล็ด', 'Seedless Tamarind Paste'],
  ['มะขามเปียก', 'Tamarind Paste'],
  ['น้ำซุปกระดูกหมู', 'Pork Bone Broth'],
  ['น้ำซุปกระดูกเข้มข้น', 'Rich Bone Broth'],
  ['น้ำซุปต้มยำ', 'Tom Yum Broth'],
  ['น้ำสต็อกหมู', 'Pork Stock'],
  ['น้ำสต็อกไก่', 'Chicken Stock'],
  ['น้ำซุป', 'Broth'],
  ['น้ำสต็อก', 'Stock'],
  ['ซอสกะเพรา', 'Holy Basil Stir-Fry Sauce'],
  ['ซอสพริกไทยดำ', 'Black Pepper Sauce'],
  ['ซอสเทอริยากิ', 'Teriyaki Sauce'],
  ['ซอสพริกศรีราชา', 'Sriracha Chili Sauce'],
  ['ซอสพริก', 'Chili Sauce'],
  ['ซอสมะเขือเทศ', 'Ketchup'],
  ['มายองเนส', 'Mayonnaise'],
  ['ผงปรุงรสหมู', 'Pork Seasoning Powder'],
  ['ผงปรุงรสไก่', 'Chicken Seasoning Powder'],
  ['ผงปรุงรส', 'Seasoning Powder'],
  ['ผงชูรส', 'MSG'],
  ['ผงพะโล้', 'Chinese Five-Spice Powder'],
  ['ผงกะหรี่', 'Curry Powder'],
  ['พริกป่น', 'Chili Flakes'],
  ['พริกเผา', 'Roasted Chili Paste'],
  ['น้ำพริกเผา', 'Roasted Chili Paste'],
  ['น้ำพริกกะปิ', 'Shrimp Paste Chili Dip'],
  ['กะปิ', 'Shrimp Paste'],
  ['น้ำตาลทรายขาว', 'White Sugar'],
  ['น้ำตาลทรายแดง', 'Brown Sugar'],
  ['น้ำตาลทราย', 'Sugar'],
  ['น้ำตาลปี๊บ', 'Palm Sugar'],
  ['น้ำตาลมะพร้าว', 'Coconut Sugar'],
  ['น้ำตาลกรวด', 'Rock Sugar'],
  ['น้ำตาล', 'Sugar'],
  ['น้ำผึ้ง', 'Honey'],
  ['น้ำส้มสายชู', 'Vinegar'],
  ['เกลือสมุทร', 'Sea Salt'],
  ['เกลือป่น', 'Fine Salt'],
  ['เกลือ', 'Salt'],
  ['น้ำมันปาล์มสำหรับผัด/ทอด', 'Palm Oil (Stir-Fry / Frying)'],
  ['น้ำมันปาล์มสำหรับทอด', 'Palm Oil for Frying'],
  ['น้ำมันปาล์ม', 'Palm Oil'],
  ['น้ำมันถั่วเหลือง', 'Soybean Oil'],
  ['น้ำมันพืช', 'Vegetable Oil'],
  ['น้ำมันงา', 'Sesame Oil'],
  ['น้ำมันกระเทียมเจียว', 'Garlic Oil'],
  ['กระเทียมเจียว', 'Crispy Fried Garlic'],
  ['หอมเจียว', 'Crispy Fried Shallots'],
  ['แป้งทอดกรอบ', 'Crispy Tempura Flour'],
  ['แป้งข้าวโพด', 'Cornstarch'],
  ['แป้งมัน', 'Tapioca Starch'],
  ['แป้งสาลี', 'Wheat Flour'],
  ['เกล็ดขนมปัง', 'Breadcrumbs'],
  ['นมสด', 'Fresh Milk'],
  ['นมข้นจืด', 'Evaporated Milk'],
  ['นมข้นหวาน', 'Condensed Milk'],
  ['หัวกะทิ', 'Coconut Cream'],
  ['กะทิกล่อง', 'Coconut Milk'],
  ['กะทิ', 'Coconut Milk'],
  ['เนยสด', 'Butter'],
  ['เนย', 'Butter'],
  ['ชีส', 'Cheese'],
  ['ถั่วลิสงคั่ว', 'Roasted Peanuts'],
  ['ถั่วลิสง', 'Peanuts'],
  ['เม็ดมะม่วงหิมพานต์', 'Cashew Nuts'],
  ['งาขาว', 'White Sesame'],
  ['งาดำ', 'Black Sesame'],

  // Herbs, Vegetables & Eggs
  ['ใบกะเพราเด็ดใบ', 'Picked Holy Basil Leaves'],
  ['ใบกะเพราป่าออร์แกนิก', 'Organic Wild Holy Basil'],
  ['ใบกะเพรา', 'Holy Basil'],
  ['กะเพรา', 'Holy Basil'],
  ['ใบโหระพา', 'Sweet Basil Leaves'],
  ['โหระพา', 'Sweet Basil'],
  ['ใบมะกรูด', 'Kaffir Lime Leaves'],
  ['มะกรูด', 'Kaffir Lime'],
  ['ตะไคร้', 'Lemongrass'],
  ['ข่า', 'Galangal'],
  ['กระชาย', 'Fingerroot'],
  ['ขิงซอย', 'Julienne Ginger'],
  ['ขิง', 'Ginger'],
  ['พริกขี้หนูแดงจินดา', "Red Bird's Eye Chili"],
  ['พริกขี้หนูสวน', "Thai Bird's Eye Chili"],
  ['พริกขี้หนู', "Bird's Eye Chili"],
  ['พริกชี้ฟ้าแดง', 'Red Spur Chili'],
  ['พริกชี้ฟ้า', 'Spur Chili'],
  ['พริกแห้ง', 'Dried Chili'],
  ['พริกหยวก', 'Bell Pepper'],
  ['พริกไทยดำ', 'Black Pepper'],
  ['พริกไทยอ่อน', 'Fresh Green Peppercorns'],
  ['พริกไทยป่น', 'Ground Pepper'],
  ['พริกไทย', 'Black Pepper'],
  ['กระเทียมไทยแกะกลีบ', 'Peeled Thai Garlic'],
  ['กระเทียมไทย', 'Thai Garlic'],
  ['กระเทียมจีน', 'Chinese Garlic'],
  ['กระเทียม', 'Garlic'],
  ['หอมแดง', 'Shallots'],
  ['หอมหัวใหญ่', 'Onion'],
  ['ต้นหอม', 'Spring Onion'],
  ['ผักชีฝรั่ง', 'Culantro'],
  ['รากผักชี', 'Coriander Root'],
  ['ผักชี', 'Coriander'],
  ['ใบเตย', 'Pandan Leaf'],
  ['มะนาว', 'Lime'],
  ['มะเขือเทศ', 'Tomato'],
  ['มะเขือเปราะ', 'Thai Eggplant'],
  ['มะเขือพวง', 'Pea Eggplant'],
  ['ผักบุ้งจีนหั่นท่อน', 'Cut Chinese Morning Glory'],
  ['ผักบุ้งจีน', 'Chinese Morning Glory'],
  ['ผักบุ้ง', 'Morning Glory'],
  ['คะน้าฮ่องกง', 'Hong Kong Kale'],
  ['คะน้า', 'Chinese Kale'],
  ['กะหล่ำปลีซอย', 'Shredded Cabbage'],
  ['กะหล่ำปลี', 'Cabbage'],
  ['ผักกาดขาว', 'Napa Cabbage'],
  ['กวางตุ้ง', 'Choy Sum'],
  ['บล็อกโคลี่', 'Broccoli'],
  ['ถั่วฝักยาว', 'Yardlong Bean'],
  ['ถั่วงอก', 'Bean Sprouts'],
  ['หน่อไม้', 'Bamboo Shoots'],
  ['ข้าวโพดอ่อน', 'Baby Corn'],
  ['แครอท', 'Carrot'],
  ['แตงกวา', 'Cucumber'],
  ['ฟักทอง', 'Pumpkin'],
  ['เห็ดฟาง', 'Straw Mushroom'],
  ['เห็ดหอม', 'Shiitake Mushroom'],
  ['เห็ดเข็มทอง', 'Enoki Mushroom'],
  ['เห็ดนางฟ้า', 'Oyster Mushroom'],
  ['เห็ดออรินจิ', 'King Oyster Mushroom'],
  ['ไข่ไก่สด (เบอร์ 2)', 'Fresh Chicken Egg (Size 2)'],
  ['ไข่ไก่สด', 'Fresh Chicken Egg'],
  ['ไข่ไก่', 'Chicken Egg'],
  ['ไข่เป็ด', 'Duck Egg'],
  ['ไข่นกกระทา', 'Quail Egg'],
  ['ข้าวสวยหอมมะลิ (หุงสุก)', 'Cooked Jasmine Rice'],
  ['ข้าวสารหอมมะลิ', 'Jasmine Rice (Uncooked)'],
  ['ข้าวหอมมะลิ', 'Jasmine Rice'],

  // Prep descriptors
  ['แกะกลีบ', 'Peeled'],
  ['หั่นชิ้น', 'Sliced'],
  ['หั่นเต๋า', 'Diced'],
  ['หั่นท่อน', 'Cut'],
  ['สับละเอียด', 'Finely Minced'],
  ['เด็ดใบ', 'Picked Leaves'],
  ['หุงสุก', 'Cooked'],
  ['แช่น้ำ', 'Soaked'],
  ['แช่แข็ง', 'Frozen'],
  ['ลอกหนัง', 'Skinless'],
  ['เลาะกระดูก', 'Boneless'],
  ['แกะเมล็ด', 'Seedless'],
  ['มันน้อย', 'Lean'],
  ['สูตรประจำร้าน', 'House Signature Recipe'],
  ['สูตรทางร้าน', 'House Recipe'],
  ['สูตรโบราณ', 'Traditional Recipe'],
  ['สูตรเด็ด', 'Signature Recipe'],
  ['สำหรับผัด/ทอด', 'for Stir-Fry / Frying'],
  ['สำหรับทอด', 'for Deep-Frying'],
  ['สำหรับผัด', 'for Stir-Frying'],

  // Packaging
  ['กล่องกระดาษคราฟท์ใส่อาหารรักษ์โลก', 'Eco Kraft Paper Food Container'],
  ['กล่องกระดาษคราฟท์อาหารรักษ์โลก', 'Eco Kraft Paper Food Container'],
  ['กล่องกระดาษใส่อาหารรักษ์โลก', 'Eco Paper Food Container'],
  ['กล่องกระดาษใส่อาหาร', 'Paper Food Box'],
  ['กล่องพลาสติก PP ไมโครเวฟพร้อมฝา', 'Microwavable PP Container with Lid'],
  ['ชุดช้อนส้อมพลาสติก + ทิชชู', 'Cutlery Set & Napkin'],
  ['ถ้วยน้ำจิ้ม 2oz + ฝา', '2oz Sauce Cup with Lid'],
  ['ถุงหูหิ้วพลาสติกรักษ์โลก', 'Eco Carrier Bag'],
  ['ถ้วยซุปกระดาษ 350ml + ฝา', '350ml Paper Soup Bowl with Lid'],
  ['กล่องกระดาษคราฟท์', 'Kraft Paper Box'],
  ['กล่องกระดาษ', 'Paper Box'],
  ['กล่องข้าว', 'Food Container Box'],
  ['กล่องพลาสติก', 'Plastic Container'],
  ['ถ้วยซุป', 'Soup Bowl'],
  ['ถ้วยน้ำจิ้ม', 'Sauce Cup'],
  ['ถุงหูหิ้ว', 'Carrier Bag'],
  ['ถุงหิ้ว', 'Carrier Bag'],
  ['ถุงพลาสติก', 'Plastic Bag'],
  ['ถุงร้อน', 'Hot Food Bag'],
  ['ช้อนส้อม', 'Cutlery Set'],
  ['ตะเกียบ', 'Chopsticks'],
  ['ทิชชู', 'Napkin'],
  ['แก้วน้ำ', 'Beverage Cup'],
  ['พร้อมฝา', 'with Lid'],
  ['รักษ์โลก', 'Eco-Friendly'],
  ['หลอด', 'Straw'],

  // Categories & Channels & Overhead
  ['อาหารจานหลัก', 'Main Dishes'],
  ['อาหารจานเดียว', 'One-Dish Meals'],
  ['อาหารจานด่วน', 'Quick One-Dish Meals'],
  ['อาหารตามสั่ง', 'Made-to-Order Dishes'],
  ['ตามสั่ง', 'Made to Order'],
  ['ผัดและกะเพรา', 'Stir-Fries & Holy Basil'],
  ['ทอดและกระเทียม', 'Fried & Garlic Dishes'],
  ['ต้มยำและแกง', 'Tom Yum & Curries'],
  ['ข้าวผัดและเส้น', 'Fried Rice & Noodles'],
  ['ยำและส้มตำ', 'Spicy Salads & Som Tum'],
  ['สเต็กและจานร้อน', 'Steaks & Hot Plates'],
  ['ของหวานและไอศกรีม', 'Desserts & Ice Cream'],
  ['เครื่องดื่มและกาแฟ', 'Beverages & Coffee'],
  ['ของทานเล่น/กับแกล้ม', 'Appetizers & Bar Bites'],
  ['ของทานเล่น', 'Appetizers'],
  ['ทานเล่น', 'Appetizers'],
  ['กับแกล้ม', 'Bar Bites'],
  ['เครื่องดื่ม', 'Beverages'],
  ['ของหวาน', 'Desserts'],
  ['เบเกอรี่', 'Bakery'],
  ['อาหารแปรรูป', 'Processed Foods'],
  ['เนื้อสัตว์และอาหารทะเล', 'Meats & Seafood'],
  ['ผักและสมุนไพร', 'Vegetables & Herbs'],
  ['เครื่องปรุงและซอส', 'Seasonings & Sauces'],
  ['ข้าวและเส้น', 'Rice & Noodles'],
  ['ไข่และเต้าหู้', 'Eggs & Tofu'],
  ['ของแห้งและเบ็ดเตล็ด', 'Dry Goods & Pantry'],
  ['บรรจุภัณฑ์', 'Packaging'],
  ['สลัดและยำ', 'Spicy Salads'],
  ['ต้มและแกง', 'Soups & Curries'],
  ['หน้าร้าน', 'Dine-in'],
  ['ทานที่ร้าน', 'Dine-in'],
  ['กินที่ร้าน', 'Dine-in'],
  ['สั่งกลับบ้าน', 'Takeaway'],
  ['กลับบ้าน', 'Takeaway'],
  ['เดลิเวอรี', 'Delivery'],
  ['กะเพราจานด่วน / ตามสั่ง', 'Holy Basil Express / Made to Order'],
  ['เส้นและก๋วยเตี๋ยว', 'Noodles & Stir-Fried Noodles'],
  ['ชุดเครื่องเคียง', 'Side Dishes'],
  ['ซอสหลัก', 'Master Sauces'],
  ['เจริญโภคภัณฑ์สด (ตลาดไท)', 'CPF Fresh (Talaad Thai)'],
  ['มหาชัยซีฟู้ดส์', 'Mahachai Seafoods'],
  ['ผักสดสวนลุงชาติ', 'Uncle Chat Fresh Garden'],
  ['ย่งฮั้วฮวด เครื่องปรุงและบรรจุภัณฑ์', 'Yong Huat Seasonings & Packaging'],
  ['ค่าเช่าที่', 'Rent'],
  ['ค่าเช่า', 'Rent'],
  ['ค่าไฟ', 'Electricity'],
  ['ค่าน้ำ', 'Water'],
  ['ค่าแก๊ส', 'Cooking Gas (LPG)'],
  ['ค่าจ้างพนักงาน', 'Staff Wages'],
  ['ค่าแรง', 'Labor Cost'],
  ['ค่าแพ็กเกจจิ้ง', 'Packaging Cost'],
  ['ค่าโฆษณา', 'Advertising'],
  ['ซ่อมบำรุง', 'Maintenance'],
  ['ค่าอุปกรณ์', 'Equipment'],
  ['เบ็ดเตล็ด', 'Miscellaneous'],
  ['โซนในร้าน', 'Indoor Zone'],
  ['โซนกลางแจ้ง', 'Outdoor Zone'],
  ['อื่นๆ', 'Other'],
  ['อื่น ๆ', 'Other'],
  ['ทั่วไป', 'General'],

  // Expanded Embedded Thai & Cafe Culinary Dictionary
  ['ผัดซีอิ๊วหมู', 'Pad See Ew with Pork'],
  ['ผัดซีอิ๊วไก่', 'Pad See Ew with Chicken'],
  ['ผัดซีอิ๊วกุ้ง', 'Pad See Ew with Shrimp'],
  ['ผัดซีอิ๊วทะเล', 'Pad See Ew with Seafood'],
  ['ราดหน้าหมู', 'Stir-Fried Noodles in Gravy with Pork'],
  ['ราดหน้าไก่', 'Stir-Fried Noodles in Gravy with Chicken'],
  ['ราดหน้าทะเล', 'Stir-Fried Noodles in Gravy with Seafood'],
  ['ข้าวผัดพริกแกง', 'Red Curry Paste Fried Rice'],
  ['ข้าวผัดพริกเผา', 'Roasted Chili Paste Fried Rice'],
  ['ข้าวหมูทอดกระเทียม', 'Fried Garlic Pork Rice'],
  ['ข้าวไก่ทอด', 'Fried Chicken Rice'],
  ['ข้าวไก่เทอริยากิ', 'Teriyaki Chicken Rice'],
  ['ข้าวหน้าเป็ด', 'Roasted Duck Rice'],
  ['ข้าวหมูอบ', 'Baked Pork Rice'],
  ['ข้าวซอยไก่', 'Khao Soi Chicken Curry Noodles'],
  ['ข้าวซอยเนื้อ', 'Khao Soi Beef Curry Noodles'],
  ['ข้าวซอย', 'Khao Soi Northern Curry Noodles'],
  ['ขนมจีนน้ำเงี้ยว', 'Fermented Rice Noodles with Northern Spicy Tomato Sauce'],
  ['ผัดมาม่า', 'Stir-Fried Instant Noodles'],
  ['ผัดวุ้นเส้น', 'Stir-Fried Glass Noodles'],
  ['มาม่าต้มยำ', 'Tom Yum Instant Noodles'],
  ['กุ้งแช่น้ำปลา', 'Raw Shrimp in Spicy Fish Sauce'],
  ['กุ้งชุบแป้งทอด', 'Tempura Shrimp'],
  ['ปลาหมึกชุบแป้งทอด', 'Crispy Fried Calamari'],
  ['ปลากะพงลุยสวน', 'Deep-Fried Sea Bass with Thai Herb Salad'],
  ['ยำปลาดุกฟู', 'Crispy Flaked Catfish Salad'],
  ['ยำสามกรอบ', 'Three-Crispy Spicy Salad'],
  ['ยำถั่วพู', 'Winged Bean Spicy Salad'],
  ['ยำเห็ดรวม', 'Mixed Mushroom Spicy Salad'],
  ['ไก่ผัดขิง', 'Stir-Fried Chicken with Ginger'],
  ['หมูมะนาว', 'Boiled Pork in Spicy Lime Garlic Sauce'],
  ['หมูคั่วเกลือ', 'Crispy Pork Stir-Fried with Chili & Salt'],
  ['ซี่โครงหมูอบน้ำผึ้ง', 'Honey-Glazed Baked Pork Ribs'],
  ['ไส้อั่ว', 'Northern Thai Herb Sausage'],
  ['น้ำพริกหนุ่ม', 'Northern Green Chili Dip'],
  ['น้ำพริกอ่อง', 'Northern Thai Pork & Tomato Chili Dip'],
  ['ปูอบวุ้นเส้น', 'Baked Crab with Glass Noodles'],
  ['หอยแมลงภู่อบหม้อดิน', 'Steamed Mussels in Clay Pot'],
  ['หอยนางรมทรงเครื่อง', 'Fresh Oysters with Thai Condiments'],
  ['ต้มยำหัวปลา', 'Tom Yum Fish Head Soup'],
  ['ต้มยำเห็ด', 'Mushroom Tom Yum Soup'],
  ['แกงเลียง', 'Thai Spicy Vegetable & Herb Soup'],
  ['แกงเทโพ', 'Red Curry with Pork Belly & Morning Glory'],
  ['ไข่ลูกเขย', 'Deep-Fried Boiled Eggs in Tamarind Sauce'],
  ['ไข่ตุ๋น', 'Steamed Savory Egg Custard'],
  ['ไข่กระทะ', 'Pan-Fried Eggs with Toppings'],
  ['หมูกระทะ', 'Thai BBQ & Hot Pot'],
  ['ชาบู', 'Shabu-Shabu'],
  ['จิ้มจุ่ม', 'Thai Clay-Pot Herb Hot Pot'],
  ['สลัดผัก', 'Garden Vegetable Salad'],
  ['ซีซาร์สลัด', 'Caesar Salad'],
  ['ชีสบอล', 'Cheese Balls'],
  ['หอมทอด', 'Crispy Onion Rings'],
  ['ปีกไก่บาร์บีคิว', 'BBQ Chicken Wings'],
  ['ขนมปังกระเทียม', 'Garlic Bread'],
  ['สปาเก็ตตี้ขี้เมาทะเล', 'Drunken Seafood Spaghetti'],
  ['สปาเก็ตตี้คาโบนาร่า', 'Spaghetti Carbonara'],
  ['สปาเก็ตตี้ซอสมะเขือเทศ', 'Spaghetti Bolognese / Tomato Sauce'],
  ['สปาเก็ตตี้', 'Spaghetti'],
  ['ชาเขียวมัทฉะ', 'Matcha Green Tea'],
  ['มัทฉะลาเต้', 'Matcha Latte'],
  ['มัทฉะ', 'Matcha'],
  ['ชาพีช', 'Peach Tea'],
  ['โซดามะนาว', 'Lime Soda'],
  ['แดงมะนาวโซดา', 'Red Syrup Lime Soda'],
  ['น้ำผึ้งมะนาว', 'Honey Lime Juice'],
  ['น้ำแตงโมปั่น', 'Watermelon Smoothie'],
  ['น้ำมะม่วงปั่น', 'Mango Smoothie'],
  ['น้ำเสาวรส', 'Passion Fruit Juice'],
  ['ช็อกโกแลตเย็น', 'Iced Chocolate'],
  ['นมชมพู', 'Iced Pink Milk'],
  ['ลอดช่อง', 'Pandan Noodles in Coconut Milk'],
  ['เฉาก๊วย', 'Grass Jelly'],
  ['ข้าวเหนียวทุเรียน', 'Durian Sticky Rice'],
  ['โรตี', 'Crispy Roti Flatbread'],
  ['บราวนี่', 'Chocolate Brownie'],
  ['ชีสเค้ก', 'Cheesecake'],
  ['วาฟเฟิล', 'Waffle'],
  ['ฮันนี่โทสต์', 'Honey Toast'],
  ['หม่าล่า', 'Mala Spicy'],
  ['วิปปิ้งครีม', 'Whipping Cream'],
  ['ชีสมอสซาเรลล่า', 'Mozzarella Cheese'],
  ['เชดดาร์ชีส', 'Cheddar Cheese'],
  ['พาร์เมซานชีส', 'Parmesan Cheese'],
  ['ซอสบาร์บีคิว', 'BBQ Sauce'],
  ['โชยุ', 'Japanese Soy Sauce'],
  ['มิริน', 'Mirin'],
  ['ทูน่า', 'Tuna'],
  ['แซลมอน', 'Salmon'],
  ['อะโวคาโด', 'Avocado'],
  ['มะม่วง', 'Mango'],
  ['สตรอว์เบอร์รี', 'Strawberry'],
  ['ลิ้นจี่', 'Lychee'],
  ['เสาวรส', 'Passion Fruit'],
  ['แตงโม', 'Watermelon'],
  ['ทุเรียน', 'Durian'],
  ['น้ำเชื่อม', 'Sugar Syrup'],
  ['ไข่มุก', 'Tapioca Pearls (Boba)'],
];

const SINGLE_WORD_DICTIONARY: Record<string, string> = {
  'หมู': 'Pork',
  'ไก่': 'Chicken',
  'เนื้อ': 'Beef',
  'เป็ด': 'Duck',
  'กุ้ง': 'Shrimp',
  'ปลา': 'Fish',
  'ปู': 'Crab',
  'หอย': 'Shellfish',
  'ไข่': 'Egg',
  'ข้าว': 'Rice',
  'เส้น': 'Noodles',
  'ผัก': 'Vegetables',
  'เห็ด': 'Mushroom',
  'พริก': 'Chili',
  'กระเทียม': 'Garlic',
  'หอม': 'Onion',
  'น้ำปลา': 'Fish Sauce',
  'น้ำมัน': 'Oil',
  'ซอส': 'Sauce',
  'น้ำจิ้ม': 'Dipping Sauce',
  'น้ำซุป': 'Broth',
  'น้ำตาล': 'Sugar',
  'เกลือ': 'Salt',
  'กะทิ': 'Coconut Milk',
  'ชีส': 'Cheese',
  'เนย': 'Butter',
  'นม': 'Milk',
  'แป้ง': 'Flour',
  'ผง': 'Powder',
  'ใบ': 'Leaves',
  'ซอย': 'Sliced',
  'บด': 'Ground',
  'สับ': 'Minced',
  'แล่': 'Filleted',
  'ตากแห้ง': 'Sun-Dried',
  'ผัด': 'Stir-Fried',
  'ทอด': 'Fried',
  'ต้ม': 'Boiled',
  'ตุ๋น': 'Braised',
  'แกง': 'Curry',
  'ย่าง': 'Grilled',
  'ปิ้ง': 'Charcoal-Grilled',
  'เผา': 'Char-Grilled',
  'นึ่ง': 'Steamed',
  'อบ': 'Baked',
  'ยำ': 'Spicy Salad',
  'ลวก': 'Blanched',
  'คั่ว': 'Dry-Roasted',
  'คลุก': 'Tossed',
  'หมัก': 'Marinated',
  'เจียว': 'Crispy Fried',
  'ตัก': 'Scoop',
  'เผ็ด': 'Spicy',
  'หวาน': 'Sweet',
  'เค็ม': 'Salty',
  'เปรี้ยว': 'Sour',
  'จืด': 'Mild',
  'ร้อน': 'Hot',
  'เย็น': 'Iced',
  'ปั่น': 'Smoothie',
  'แห้ง': 'Dry',
  'น้ำ': 'Soup',
  'เพิ่ม': 'Extra',
  'ไม่': 'No',
  'แยก': 'Separate',
  'ใส่': 'With',
  'รวม': 'Mixed',
  'สด': 'Fresh',
  'กรอบ': 'Crispy',
  'นุ่ม': 'Tender',
  'สุก': 'Cooked',
  'ดิบ': 'Raw',
  'อ่อน': 'Young',
  'แก่': 'Mature',
  'แดง': 'Red',
  'เขียว': 'Green',
  'ขาว': 'White',
  'ดำ': 'Black',
  'เหลือง': 'Yellow',
  'ชิ้น': 'Piece',
  'ชุด': 'Set',
  'จาน': 'Plate',
  'ชาม': 'Bowl',
  'ถ้วย': 'Cup',
  'แก้ว': 'Glass',
  'กล่อง': 'Box',
  'ถุง': 'Bag',
  'ขวด': 'Bottle',
  'ซอง': 'Sachet',
  'แพ็ค': 'Pack',
  'แพค': 'Pack',
  'กระป๋อง': 'Can',
  'ฝา': 'Lid',
  'สูตร': 'Recipe',
  'เมนู': 'Menu',
  'วัตถุดิบ': 'Ingredient',
  'เครื่องปรุง': 'Seasoning',
  'สมุนไพร': 'Herbs',
  'อาหาร': 'Food',
  'จานเดียว': 'One-Dish Meal',
  'ต้นตำรับ': 'Original',
  'ไทย': 'Thai',
};

// Build exact lookup map (phrase wins over single word when identical keys exist)
const EXACT_DICTIONARY = new Map<string, string>();
for (const [k, v] of Object.entries(SINGLE_WORD_DICTIONARY)) {
  EXACT_DICTIONARY.set(normalizeThaiForTranslation(k), v);
}
for (const [k, v] of PHRASE_DICTIONARY) {
  const norm = normalizeThaiForTranslation(k);
  if (!EXACT_DICTIONARY.has(norm)) {
    EXACT_DICTIONARY.set(norm, v);
  }
}

// Hazardous single-word fragments that must NEVER be used to split inside unknown compound words in DP
const DP_HAZARDOUS_TOKENS = new Set(['น้ำ', 'ตัก', 'ผง', 'ใบ', 'มัน', 'ซอย', 'สุก', 'อ่อน', 'แก่']);

// Safe connector stopwords allowed inside DP ONLY at word boundaries or clear conjunctions
const DP_CONJUNCTION_TOKENS: Record<string, string> = {
  'และ': '&',
  'กับ': 'with',
  'พร้อม': 'with',
  'หรือ': 'or',
  'สำหรับ': 'for',
};
const DP_BOUNDARY_OMIT_STOPWORDS = new Set(['สูตร', 'ตรา', 'แบบ', 'อย่าง', 'ใน', 'ที่', 'จาก', 'โดย', 'เพื่อ', 'ของ', 'ด้วย', 'เป็น', 'มี', 'ให้', 'ได้', 'ต่อ', 'ละ']);

const DP_DICTIONARY_ENTRIES: Array<[string, string]> = Array.from(EXACT_DICTIONARY.entries())
  .filter(([th]) => !DP_HAZARDOUS_TOKENS.has(th))
  .sort((a, b) => b[0].length - a[0].length);

export interface EmbeddedFoodDictionaryEntry {
  thai: string;
  english: string;
  kind: 'phrase' | 'word';
}

const SINGLE_WORD_KEYS = new Set(
  Object.keys(SINGLE_WORD_DICTIONARY).map((k) => normalizeThaiForTranslation(k))
);

/**
 * Returns a read-only view of all culinary terms embedded in the app dictionary.
 */
export function getBuiltInFoodDictionary(): EmbeddedFoodDictionaryEntry[] {
  const result: EmbeddedFoodDictionaryEntry[] = [];
  for (const [thai, english] of EXACT_DICTIONARY.entries()) {
    result.push({
      thai,
      english,
      kind: SINGLE_WORD_KEYS.has(thai) ? 'word' : 'phrase',
    });
  }
  return result;
}

function toTitleCase(text: string): string {
  const lowercaseWords = new Set(['with', 'and', 'on', 'in', 'the', 'of', 'for', 'or', 'by', 'to', 'a']);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && lowercaseWords.has(lower)) {
        return lower;
      }
      if (/^[A-Z0-9()-]+$/.test(word) && word.length <= 5) {
        return word;
      }
      if (/^\d+[a-zA-Z]+$/.test(word)) {
        return word;
      }
      if (word.startsWith('(') && word.length > 1) {
        const inner = word.slice(1);
        if (/^[A-Z0-9)-]+$/.test(inner)) {
          return '(' + inner;
        }
        return '(' + inner.charAt(0).toUpperCase() + inner.slice(1);
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function toModifierForm(en: string): string {
  const t = en.trim();
  if (t === 'Vegetables') return 'Vegetable';
  if (t === 'Mixed Vegetables') return 'Mixed Vegetable';
  if (t === 'Mushrooms') return 'Mushroom';
  if (t === 'Wontons') return 'Wonton';
  if (t === 'Meatballs') return 'Meatball';
  if (t === 'Noodles') return 'Noodle';
  return t;
}

function toDishCountableForm(en: string): string {
  const t = en.trim();
  if (t === 'Mushroom') return 'Mushrooms';
  return t;
}

const COOKING_MODIFIER_PREFIX_MAP: Record<string, string> = {
  'ทอด': 'Fried',
  'ปิ้ง': 'Grilled',
  'ย่าง': 'Grilled',
  'เผา': 'Char-Grilled',
  'นึ่ง': 'Steamed',
  'ต้ม': 'Boiled',
  'ลวก': 'Blanched',
  'อบ': 'Baked',
  'ตุ๋น': 'Braised',
  'สับ': 'Minced',
  'บด': 'Ground',
  'สไลซ์': 'Sliced',
  'กรอบ': 'Crispy',
  'สด': 'Fresh',
  'รวม': 'Mixed',
};

/**
 * 100%-coverage DP segmentation over known safe dictionary tokens + user glossary + ASCII segments.
 * Returns null immediately if ANY Thai character cannot be covered completely (Rule A).
 */
function segmentThai100Percent(
  thaiInput: string,
  glossary: Record<string, string> = {}
): string | null {
  const n = thaiInput.length;
  if (n === 0) return null;
  if (!HAS_THAI_RE.test(thaiInput)) return thaiInput;

  const glossaryEntries: Array<[string, string, boolean]> = [];
  const seenGlossaryKeys = new Set<string>();
  for (const [rawTh, rawEn] of Object.entries(glossary)) {
    const th = normalizeThaiForTranslation(rawTh);
    const en = (rawEn || '').trim();
    if (
      th &&
      HAS_THAI_RE.test(th) &&
      !DP_HAZARDOUS_TOKENS.has(th) &&
      en &&
      !HAS_THAI_RE.test(en) &&
      !seenGlossaryKeys.has(th)
    ) {
      seenGlossaryKeys.add(th);
      glossaryEntries.push([th, en, true]);
    }
  }

  const dpEntries: Array<[string, string, boolean]> = glossaryEntries.length
    ? [
        ...glossaryEntries,
        ...DP_DICTIONARY_ENTRIES.filter(([th]) => !seenGlossaryKeys.has(th)).map(
          ([th, en]) => [th, en, false] as [string, string, boolean]
        ),
      ].sort((a, b) => b[0].length - a[0].length)
    : DP_DICTIONARY_ENTRIES.map(([th, en]) => [th, en, false] as [string, string, boolean]);

  type Step = { nextIndex: number; tokens: string[]; score: number } | null;
  const memo = new Array<Step | undefined>(n + 1);

  const solve = (pos: number): Step => {
    if (pos === n) return { nextIndex: n, tokens: [], score: 0 };
    if (memo[pos] !== undefined) return memo[pos]!;

    const remaining = thaiInput.slice(pos);

    // 1. Whitespace
    const wsMatch = remaining.match(/^\s+/);
    if (wsMatch) {
      const rest = solve(pos + wsMatch[0].length);
      const res = rest ? { nextIndex: n, tokens: rest.tokens, score: rest.score } : null;
      memo[pos] = res;
      return res;
    }

    // 2. Non-Thai ASCII run (e.g., "(L)", "100g", "+")
    const asciiMatch = remaining.match(/^[^\u0E00-\u0E7F\s]+/);
    if (asciiMatch) {
      const seg = asciiMatch[0].trim();
      const rest = solve(pos + asciiMatch[0].length);
      const res = rest
        ? {
            nextIndex: n,
            tokens: seg ? [seg, ...rest.tokens] : rest.tokens,
            score: rest.score + 1,
          }
        : null;
      memo[pos] = res;
      return res;
    }

    let best: Step = null;

    // 3. Dictionary phrases, user glossary terms & safe words (must achieve 100% coverage of remainder)
    for (const [thPhrase, enTranslation, isCustomGlossary] of dpEntries) {
      if (remaining.startsWith(thPhrase)) {
        const rest = solve(pos + thPhrase.length);
        if (rest) {
          // Prefer fewer, longer phrase matches; user glossary gets a slight tie-break boost
          const candidateScore = rest.score + (isCustomGlossary ? 99 : 100) - thPhrase.length;
          if (!best || candidateScore < best.score) {
            best = {
              nextIndex: n,
              tokens: [enTranslation, ...rest.tokens],
              score: candidateScore,
            };
          }
        }
      }
    }

    // 4. Explicit Thai conjunction words
    for (const [conj, enConj] of Object.entries(DP_CONJUNCTION_TOKENS)) {
      if (remaining.startsWith(conj)) {
        const rest = solve(pos + conj.length);
        if (rest) {
          const candidateScore = rest.score + 95;
          if (!best || candidateScore < best.score) {
            best = {
              nextIndex: n,
              tokens: [enConj, ...rest.tokens],
              score: candidateScore,
            };
          }
        }
      }
    }

    // 5. Boundary-only grammar filler words (never matched mid-word inside unknown Thai words)
    const prevChar = pos > 0 ? thaiInput[pos - 1] : '';
    const isAtWordStart = pos === 0 || /\s/.test(prevChar);
    if (isAtWordStart) {
      for (const sw of DP_BOUNDARY_OMIT_STOPWORDS) {
        if (remaining.startsWith(sw)) {
          const afterPos = pos + sw.length;
          const nextChar = afterPos < n ? thaiInput[afterPos] : '';
          const isAtWordEnd = afterPos === n || /\s/.test(nextChar);
          if (isAtWordEnd) {
            const rest = solve(afterPos);
            if (rest) {
              const candidateScore = rest.score + 98;
              if (!best || candidateScore < best.score) {
                best = {
                  nextIndex: n,
                  tokens: rest.tokens,
                  score: candidateScore,
                };
              }
            }
          }
        }
      }
    }

    memo[pos] = best;
    return best;
  };

  const solved = solve(0);
  if (!solved || solved.tokens.length === 0) {
    return null;
  }

  const joined = solved.tokens
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(Sauce)\s+\1\b/gi, '$1')
    .replace(/\b(Broth)\s+\1\b/gi, '$1')
    .replace(/\b(Curry)\s+\1\b/gi, '$1')
    .trim();

  if (!joined || HAS_THAI_RE.test(joined)) {
    return null;
  }
  return joined;
}

interface InternalClauseResolution {
  en: string;
  source: 'glossary' | 'dictionary' | 'pattern';
  confidence: 'high' | 'medium';
}

function resolveCompoundClauseInternal(
  normalizedInput: string,
  glossary: Record<string, string>,
  depth = 0
): InternalClauseResolution | null {
  const trimmed = normalizedInput.trim();
  if (!trimmed) return null;

  if (!HAS_THAI_RE.test(trimmed)) {
    return { en: trimmed, source: 'dictionary', confidence: 'high' };
  }

  if (depth > 5) return null;

  // Step 1: Glossary lookup
  const glossaryHit = glossary[trimmed];
  if (glossaryHit && !HAS_THAI_RE.test(glossaryHit)) {
    return { en: glossaryHit.trim(), source: 'glossary', confidence: 'high' };
  }

  // Step 2: Exact dictionary match
  const exactHit = EXACT_DICTIONARY.get(trimmed);
  if (exactHit) {
    return { en: exactHit, source: 'dictionary', confidence: 'high' };
  }

  // Step 2b: Slash-separated multi-item phrases (both/all parts MUST translate)
  if (trimmed.includes('/')) {
    const slashParts = trimmed.split(/\s*\/\s*/).map((p) => p.trim());
    if (slashParts.length > 1 && slashParts.every(Boolean)) {
      const resolvedParts: InternalClauseResolution[] = [];
      let allOk = true;
      for (const part of slashParts) {
        const res = resolveCompoundClauseInternal(part, glossary, depth + 1);
        if (!res) {
          allOk = false;
          break;
        }
        resolvedParts.push(res);
      }
      if (allOk) {
        const hasGlossary = resolvedParts.some((r) => r.source === 'glossary');
        const hasPattern = resolvedParts.some((r) => r.source === 'pattern');
        return {
          en: resolvedParts.map((r) => r.en).join(' / '),
          source: hasGlossary ? 'glossary' : hasPattern ? 'pattern' : 'dictionary',
          confidence: hasPattern ? 'medium' : 'high',
        };
      }
    }
  }

  // Step 3a: Parenthetical suffix like "ปอเปี๊ยะผัก (L)" or "หมูบด (มันน้อย)"
  const parenMatch = trimmed.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (parenMatch) {
    const mainRes = resolveCompoundClauseInternal(parenMatch[1].trim(), glossary, depth + 1);
    const subRes = resolveCompoundClauseInternal(parenMatch[2].trim(), glossary, depth + 1);
    if (mainRes && subRes) {
      return {
        en: `${mainRes.en} (${subRes.en})`,
        source: mainRes.source === 'glossary' ? 'glossary' : 'pattern',
        confidence: mainRes.confidence === 'high' && subRes.confidence === 'high' ? 'high' : 'medium',
      };
    }
    return null;
  }

  // Step 3b: Whitespace-separated leading or trailing pure-ASCII tokens (e.g. "100g กุ้งสด", "ปอเปี๊ยะผัก XL")
  const trailingAscii = trimmed.match(/^(.+?)\s+([^\u0E00-\u0E7F\s]+)$/);
  if (trailingAscii && HAS_THAI_RE.test(trailingAscii[1])) {
    const coreRes = resolveCompoundClauseInternal(trailingAscii[1].trim(), glossary, depth + 1);
    if (coreRes) {
      return {
        en: `${coreRes.en} ${trailingAscii[2].trim()}`,
        source: coreRes.source === 'glossary' ? 'glossary' : 'pattern',
        confidence: coreRes.confidence,
      };
    }
    return null;
  }

  const leadingAscii = trimmed.match(/^([^\u0E00-\u0E7F\s]+)\s+(.+)$/);
  if (leadingAscii && HAS_THAI_RE.test(leadingAscii[2])) {
    const coreRes = resolveCompoundClauseInternal(leadingAscii[2].trim(), glossary, depth + 1);
    if (coreRes) {
      return {
        en: `${leadingAscii[1].trim()} ${coreRes.en}`,
        source: coreRes.source === 'glossary' ? 'glossary' : 'pattern',
        confidence: coreRes.confidence,
      };
    }
    return null;
  }

  // Step 3c: Dish Base + optional ไส้ + Ingredient + optional Cooking/State
  const wrappedDishBases: Array<[string, string]> = [
    ['ปอเปี๊ยะ', 'Spring Rolls'],
    ['เกี๊ยว', 'Wontons'],
    ['ซาลาเปา', 'Steamed Buns'],
    ['ขนมจีบ', 'Steamed Dumplings'],
  ];
  for (const [baseTh, baseEn] of wrappedDishBases) {
    if (trimmed.startsWith(baseTh) && trimmed.length > baseTh.length) {
      const afterBase = trimmed.slice(baseTh.length).replace(/^ไส้/, '').trim();
      if (!afterBase) continue;

      // Try exact match of remainder with cooking suffix peeled off first
      const prepMatch = afterBase.match(/^(.+?)(ทอด|ปิ้ง|ย่าง|นึ่ง|ต้ม|ลวก|อบ|สด|กรอบ)$/);
      if (prepMatch && prepMatch[1].trim()) {
        const fillRes = resolveCompoundClauseInternal(prepMatch[1].trim(), glossary, depth + 1);
        const prepWord = COOKING_MODIFIER_PREFIX_MAP[prepMatch[2]];
        if (fillRes && prepWord) {
          return {
            en: `${prepWord} ${toModifierForm(fillRes.en)} ${baseEn}`,
            source: 'pattern',
            confidence: 'high',
          };
        }
      }

      // Otherwise treat remainder directly as filling ingredient (or prep-only if matched by dict)
      const fillRes = resolveCompoundClauseInternal(afterBase, glossary, depth + 1);
      if (fillRes) {
        return {
          en: `${toModifierForm(fillRes.en)} ${baseEn}`,
          source: 'pattern',
          confidence: 'high',
        };
      }
      return null;
    }
  }

  // Step 3d: Multi-word culinary suffix rules
  const suffixRules: Array<[RegExp, (innerEn: string) => string]> = [
    [/^(.+?)ราดข้าว$/, (x) => `${x} on Rice`],
    [/^(.+?)กับข้าว$/, (x) => `${x} (A La Carte)`],
    [/^(.+?)ทอดกระเทียมพริกไทย$/, (x) => `Fried Garlic & Pepper ${x}`],
    [/^(.+?)ทอดกระเทียม$/, (x) => `Fried Garlic ${x}`],
    [/^(.+?)ผัดผงกะหรี่$/, (x) => `Stir-Fried ${x} in Curry Powder`],
    [/^(.+?)ผัดพริกเผา$/, (x) => `Stir-Fried ${x} with Roasted Chili Paste`],
    [/^(.+?)ผัดพริกแกง$/, (x) => `Stir-Fried ${x} with Red Curry Paste`],
    [/^(.+?)ผัดน้ำมันหอย$/, (x) => `Stir-Fried ${x} in Oyster Sauce`],
    [/^(.+?)ผัดกะเพรา$/, (x) => `Stir-Fried Holy Basil with ${x}`],
    [/^(.+?)นึ่งมะนาว$/, (x) => `Steamed ${x} in Spicy Lime Sauce`],
    [/^(.+?)ทอด$/, (x) => `Fried ${toDishCountableForm(x)}`],
    [/^(.+?)ย่าง$/, (x) => `Grilled ${toDishCountableForm(x)}`],
    [/^(.+?)ปิ้ง$/, (x) => `Grilled ${toDishCountableForm(x)}`],
    [/^(.+?)เผา$/, (x) => `Char-Grilled ${toDishCountableForm(x)}`],
    [/^(.+?)นึ่ง$/, (x) => `Steamed ${toDishCountableForm(x)}`],
    [/^(.+?)ต้ม$/, (x) => `Boiled ${toDishCountableForm(x)}`],
    [/^(.+?)ลวก$/, (x) => `Blanched ${toDishCountableForm(x)}`],
    [/^(.+?)อบ$/, (x) => `Baked ${toDishCountableForm(x)}`],
    [/^(.+?)ตุ๋น$/, (x) => `Braised ${toDishCountableForm(x)}`],
    [/^(.+?)สไลซ์$/, (x) => `Sliced ${x}`],
    [/^(.+?)สับ$/, (x) => `Minced ${x}`],
    [/^(.+?)บด$/, (x) => `Ground ${x}`],
    [/^(.+?)รวม$/, (x) => `Mixed ${toDishCountableForm(x)}`],
    [/^(.+?)สด$/, (x) => `Fresh ${toDishCountableForm(x)}`],
  ];

  for (const [regex, formatter] of suffixRules) {
    const m = trimmed.match(regex);
    if (m && m[1].trim()) {
      const innerRes = resolveCompoundClauseInternal(m[1].trim(), glossary, depth + 1);
      if (innerRes) {
        return {
          en: formatter(innerRes.en),
          source: 'pattern',
          confidence: 'medium',
        };
      }
    }
  }

  // Step 3e: Culinary prefix rules (specific patterns BEFORE generic ผัด)
  const prefixRules: Array<[RegExp, (innerEn: string) => string]> = [
    [/^ข้าวผัดกะเพรา(.+)$/, (x) => `Holy Basil & ${x} Fried Rice`],
    [/^ข้าวผัด(.+)$/, (x) => `${x} Fried Rice`],
    [/^ข้าวต้ม(.+)$/, (x) => `${x} Rice Soup`],
    [/^ข้าวกะเพรา(.+)$/, (x) => `Stir-Fried Holy Basil with ${x} on Rice`],
    [/^ผัดกะเพรา(.+)$/, (x) => `Stir-Fried Holy Basil with ${x}`],
    [/^กะเพรา(.+)$/, (x) => `Holy Basil ${x}`],
    [/^ผัดซีอิ๊ว(.+)$/, (x) => `Pad See Ew with ${x}`],
    [/^ผัดไทย(.+)$/, (x) => `Pad Thai with ${x}`],
    [/^ผัดพริกแกง(.+)$/, (x) => `Stir-Fried Red Curry Paste with ${x}`],
    [/^ผัดพริกเผา(.+)$/, (x) => `Stir-Fried Roasted Chili Paste with ${x}`],
    [/^ผัดผงกะหรี่(.+)$/, (x) => `Stir-Fried Curry Powder with ${x}`],
    [/^ผัดน้ำมันหอย(.+)$/, (x) => `Stir-Fried ${x} in Oyster Sauce`],
    [/^ผัดขี้เมา(.+)$/, (x) => `Spicy Drunken Stir-Fried ${x}`],
    [/^ผัดเปรี้ยวหวาน(.+)$/, (x) => `Sweet & Sour Stir-Fried ${x}`],
    [/^ผัด(.+)$/, (x) => `Stir-Fried ${toDishCountableForm(x)}`],
    [/^ต้มยำ(.+)$/, (x) => `Tom Yum ${x}`],
    [/^ต้มข่า(.+)$/, (x) => `Coconut Galangal Soup with ${x}`],
    [/^ต้มแซ่บ(.+)$/, (x) => `Spicy ${x} Soup`],
    [/^ต้มจืด(.+)$/, (x) => `Clear ${x} Soup`],
    [/^แกงเขียวหวาน(.+)$/, (x) => `Green Curry with ${x}`],
    [/^แกงเผ็ด(.+)$/, (x) => `Red Curry with ${x}`],
    [/^แกงแดง(.+)$/, (x) => `Red Curry with ${x}`],
    [/^แกงพะแนง(.+)$/, (x) => `Panang Curry with ${x}`],
    [/^พะแนง(.+)$/, (x) => `Panang Curry with ${x}`],
    [/^แกงมัสมั่น(.+)$/, (x) => `Massaman Curry with ${x}`],
    [/^แกงส้ม(.+)$/, (x) => `Sour Curry with ${x}`],
    [/^ลาบ(.+)$/, (x) => `Spicy ${x} Salad (Larb)`],
    [/^น้ำตก(.+)$/, (x) => `Grilled ${x} Waterfall Salad`],
    [/^ยำ(.+)$/, (x) => `Spicy ${x} Salad`],
    [/^ส้มตำ(.+)$/, (x) => `Papaya Salad with ${x}`],
    [/^ก๋วยเตี๋ยว(.+)$/, (x) => `${x} Noodles`],
    [/^ราดหน้า(.+)$/, (x) => `Stir-Fried Noodles in Gravy with ${x}`],
    [/^สุกี้แห้ง(.+)$/, (x) => `Dry Sukiyaki with ${x}`],
    [/^สุกี้น้ำ(.+)$/, (x) => `Sukiyaki Soup with ${x}`],
    [/^ซอส(.+)$/, (x) => (x.toLowerCase().includes('sauce') ? x : `${x} Sauce`)],
    [/^น้ำจิ้ม(.+)$/, (x) => (x.toLowerCase().includes('sauce') ? x : `${x} Dipping Sauce`)],
    [/^น้ำซุป(.+)$/, (x) => (x.toLowerCase().includes('broth') || x.toLowerCase().includes('soup') ? x : `${x} Broth`)],
    [/^น้ำสต็อก(.+)$/, (x) => `${x} Stock`],
    [/^ไม่ใส่(.+)$/, (x) => `No ${x}`],
    [/^เพิ่ม(.+)$/, (x) => `Extra ${x}`],
    [/^แยก(.+)$/, (x) => `Separate ${x}`],
  ];

  for (const [regex, formatter] of prefixRules) {
    const m = trimmed.match(regex);
    if (m && m[1].trim()) {
      const innerRes = resolveCompoundClauseInternal(m[1].trim(), glossary, depth + 1);
      if (innerRes) {
        return {
          en: formatter(innerRes.en),
          source: 'pattern',
          confidence: 'medium',
        };
      }
    }
  }

  // Step 3f: Strict 100%-coverage DP word/phrase segmentation (including learned user glossary)
  const dpEn = segmentThai100Percent(trimmed, glossary);
  if (dpEn) {
    return {
      en: dpEn,
      source: 'pattern',
      confidence: 'medium',
    };
  }

  return null;
}

/**
 * Synchronous deterministic resolution returning metadata (en, source, confidence, needsReview).
 * Returns { en: '', source: 'none', confidence: 'low', needsReview: true } when unresolved.
 */
export function resolveMenuNameSync(
  input: string,
  options: TranslateMenuNameOptions = {}
): TranslateMenuNameResult {
  const { manualEnglish, isManuallyEdited, glossary: optionGlossary } = options;

  if (isManuallyEdited && manualEnglish && manualEnglish.trim()) {
    const cleanManual = manualEnglish.trim();
    if (!HAS_THAI_RE.test(cleanManual)) {
      return {
        en: cleanManual,
        source: 'manual',
        confidence: 'high',
        needsReview: false,
      };
    }
  }

  const rawTrimmed = (input || '').trim();
  if (!rawTrimmed) {
    return { en: '', source: 'none', confidence: 'high', needsReview: false };
  }

  if (!HAS_THAI_RE.test(rawTrimmed)) {
    return { en: rawTrimmed, source: 'dictionary', confidence: 'high', needsReview: false };
  }

  const mergedGlossary: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...getShopTranslationGlossary(), ...(optionGlossary || {}) })) {
    const normK = normalizeThaiForTranslation(k);
    const val = (v || '').trim();
    if (normK && val && !HAS_THAI_RE.test(val)) {
      mergedGlossary[normK] = val;
    }
  }

  const normalized = normalizeThaiForTranslation(rawTrimmed);
  if (!normalized) {
    return { en: '', source: 'none', confidence: 'low', needsReview: true };
  }

  const resolved = resolveCompoundClauseInternal(normalized, mergedGlossary, 0);
  if (!resolved) {
    return { en: '', source: 'none', confidence: 'low', needsReview: true };
  }

  const formatted =
    resolved.source === 'glossary'
      ? resolved.en.trim()
      : toTitleCase(resolved.en.replace(/\s+/g, ' ').trim());

  if (!formatted || HAS_THAI_RE.test(formatted)) {
    return { en: '', source: 'none', confidence: 'low', needsReview: true };
  }

  return {
    en: formatted,
    source: resolved.source,
    confidence: resolved.confidence,
    needsReview: false,
  };
}

/**
 * Primary async translation API for forms and batch actions.
 * In Phase 1, executes steps (1) manual/glossary -> (2) exact dictionary -> (3) pattern/DP -> unresolved (needsReview: true).
 */
export async function translateMenuName(
  input: string,
  options: TranslateMenuNameOptions = {}
): Promise<TranslateMenuNameResult> {
  return resolveMenuNameSync(input, options);
}

/**
 * Synchronous deterministic Thai -> English translator preserving the existing export contract.
 * Returns '' when a Thai phrase cannot be 100% translated cleanly (never romanizes or emits partial results).
 */
export function translateThaiToEnglish(input: string): string {
  return resolveMenuNameSync(input).en;
}

/**
 * Shared R7 resolver across forms, posBridge, and costing views:
 * Reads valid stored non-Thai English name first; falls back to translation ONLY when missing/blank/Thai.
 * Returns '' if unresolved (never leaks Thai text into English storage fields).
 */
export function resolveEntityEnglishName(
  thaiName?: string | null,
  storedEnglish?: string | null
): string {
  const stored = (storedEnglish || '').trim();
  if (stored && !HAS_THAI_RE.test(stored)) {
    return stored;
  }
  const source = (thaiName || stored || '').trim();
  if (!source) return '';
  if (!HAS_THAI_RE.test(source)) return source;
  return translateThaiToEnglish(source);
}

const DEFAULT_PLACEHOLDER_EN_VALUES = new Set([
  '',
  'new variant',
  'new option',
  'choice 1',
  'choice 2',
  'standard',
]);

/**
 * Automatically learns and persists unknown Thai food terms or user-customized English translations
 * into the shop dictionary so future items and compound dishes translate automatically.
 * Returns true if the persistent dictionary was updated.
 */
export function learnShopTranslation(
  thaiTerm?: string | null,
  englishTerm?: string | null,
  options: { isManual?: boolean } = {}
): boolean {
  const normTh = normalizeThaiForTranslation((thaiTerm || '').trim());
  const cleanEn = (englishTerm || '').trim();
  if (!normTh || !HAS_THAI_RE.test(normTh)) return false;
  if (!cleanEn || HAS_THAI_RE.test(cleanEn) || cleanEn.length > 120) return false;

  // Never pollute the dictionary with default English UI placeholders unless Thai actually translates to that
  const cleanLower = cleanEn.toLowerCase();
  const builtIn = resolveCompoundClauseInternal(normTh, {}, 0);
  const builtInEn = builtIn ? toTitleCase(builtIn.en.replace(/\s+/g, ' ').trim()) : '';

  if (
    DEFAULT_PLACEHOLDER_EN_VALUES.has(cleanLower) &&
    builtInEn.toLowerCase() !== cleanLower
  ) {
    return false;
  }

  const current = getShopTranslationGlossary();
  if (current[normTh] === cleanEn) {
    return false;
  }

  // Learn when:
  // 1) The built-in embedded dictionary doesn't know this Thai term (builtInEn === ''), OR
  // 2) The user explicitly customized the English translation (isManual) to something different from built-in
  const isUnknownToBuiltIn = !builtInEn;
  const isCustomOverride =
    Boolean(options.isManual) && builtInEn.toLowerCase() !== cleanLower;

  if (!isUnknownToBuiltIn && !isCustomOverride) {
    return false;
  }

  upsertShopTranslationEntry(normTh, cleanEn);
  return true;
}

/**
 * Computes the next English name value when the Thai name changes.
 * Preserves any manually customized English name, while automatically translating
 * empty, placeholder, or previously auto-translated English fields.
 */
export function computeAutoEnglishName(params: {
  previousThai?: string;
  nextThai: string;
  currentEnglish?: string;
  isManuallyEdited?: boolean;
}): string {
  const { previousThai = '', nextThai, currentEnglish = '', isManuallyEdited = false } = params;
  if (isManuallyEdited && currentEnglish.trim().length > 0) {
    return currentEnglish;
  }

  const currEnTrimmed = currentEnglish.trim();
  const prevAuto = previousThai.trim() ? translateThaiToEnglish(previousThai) : '';

  const shouldAutoUpdate =
    !currEnTrimmed ||
    DEFAULT_PLACEHOLDER_EN_VALUES.has(currEnTrimmed.toLowerCase()) ||
    currEnTrimmed === previousThai.trim() ||
    HAS_THAI_RE.test(currEnTrimmed) ||
    (prevAuto && currEnTrimmed.toLowerCase() === prevAuto.toLowerCase());

  if (!shouldAutoUpdate) {
    return currentEnglish;
  }

  return translateThaiToEnglish(nextThai);
}

/**
 * Resolves the display string for any named record/field based on current app language.
 * - In 'th': prefers non-empty Thai string, falls back to English/fallback.
 * - In 'en': prefers clean non-Thai English string; if missing or still contains Thai, auto-translates!
 */
export function getLocalizedText(
  lang: 'th' | 'en',
  thText?: string | null,
  enText?: string | null
): string {
  const th = (thText || '').trim();
  const en = (enText || '').trim();

  if (lang === 'th') {
    return th || en;
  }

  if (en && !HAS_THAI_RE.test(en)) {
    return en;
  }

  const source = th || en;
  if (!source) return '';
  if (!HAS_THAI_RE.test(source)) return source;
  return translateThaiToEnglish(source) || source;
}

const UNIT_EN_MAP: Record<string, string> = {
  'ตัว': 'pc',
  'ฟอง': 'egg',
  'ชิ้น': 'pc',
  'แพ็ค': 'pack',
  'แพค': 'pack',
  'ขวด': 'bottle',
  'จาน': 'plate',
  'ถ้วย': 'cup',
  'มัด': 'bunch',
  'ชุด': 'set',
  'ถุง': 'bag',
  'กล่อง': 'box',
  'ซอง': 'sachet',
  'กระป๋อง': 'can',
  'กรัม': 'g',
  'กิโลกรัม': 'kg',
  'มิลลิลิตร': 'ml',
  'ลิตร': 'L',
  'ช้อนโต๊ะ': 'tbsp',
  'ช้อนชา': 'tsp',
  'ลูก': 'pc',
  'อัน': 'pc',
  'ที่': 'portion',
  'เสิร์ฟ': 'serving',
  'ไม้': 'skewer',
  'หัว': 'head',
  'ใบ': 'leaf',
  'แผ่น': 'sheet',
};

/**
 * Localizes unit tokens (e.g. 'ฟอง' -> 'egg', 'ชิ้น' -> 'pc') when viewing in English.
 */
export function localizeUnit(unit: string | undefined | null, lang: 'th' | 'en'): string {
  const raw = (unit || '').trim();
  if (!raw || lang === 'th') return raw;
  return UNIT_EN_MAP[raw] || (HAS_THAI_RE.test(raw) ? translateThaiToEnglish(raw) || raw : raw);
}
