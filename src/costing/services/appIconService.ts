/**
 * App Icon Customization Service
 * Allows users to choose preset culinary icons or upload their own custom restaurant logo.
 * Dynamically updates document favicon, apple-touch-icon, and manifest in the browser.
 */

export interface AppIconPreset {
  id: string;
  nameTh: string;
  nameEn: string;
  descriptionTh: string;
  category: 'culinary' | 'minimal' | 'custom';
  svgDataUri: string;
  themeColor: string;
}

const STORAGE_KEY_CUSTOM_ICON = 'tonys_custom_app_icon_v1';
const STORAGE_KEY_CUSTOM_THEME = 'tonys_custom_theme_color_v1';

// Default signature icon SVG
const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#EA580C"/><stop offset="50%" stop-color="#F97316"/><stop offset="100%" stop-color="#D97706"/>
    </linearGradient>
    <linearGradient id="hatG" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#F1F5F9"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgG)"/>
  <circle cx="256" cy="256" r="210" fill="#FFFFFF" opacity="0.08"/>
  <path d="M 256 100 C 215 100 185 125 175 160 C 145 160 120 190 125 225 C 130 255 155 275 185 275 L 327 275 C 357 275 382 255 387 225 C 392 190 367 160 337 160 C 327 125 297 100 256 100 Z" fill="url(#hatG)"/>
  <rect x="180" y="270" width="152" height="42" rx="8" fill="#FFFFFF"/>
  <rect x="180" y="296" width="152" height="8" rx="2" fill="#FBBF24"/>
  <g transform="translate(146, 305)">
    <rect width="220" height="135" rx="24" fill="#0F172A" stroke="#FBBF24" stroke-width="4"/>
    <rect x="18" y="16" width="184" height="34" rx="8" fill="#1E293B"/>
    <text x="30" y="39" font-family="sans-serif" font-weight="900" font-size="19" fill="#10B981">฿ COST %</text>
    <text x="188" y="39" text-anchor="end" font-family="sans-serif" font-weight="900" font-size="19" fill="#38BDF8">32.5%</text>
    <rect x="18" y="60" width="38" height="26" rx="6" fill="#334155"/>
    <rect x="66" y="60" width="38" height="26" rx="6" fill="#334155"/>
    <rect x="114" y="60" width="38" height="26" rx="6" fill="#334155"/>
    <rect x="162" y="60" width="40" height="26" rx="6" fill="#F97316"/>
    <rect x="18" y="94" width="38" height="26" rx="6" fill="#334155"/>
    <rect x="66" y="94" width="38" height="26" rx="6" fill="#334155"/>
    <rect x="114" y="94" width="38" height="26" rx="6" fill="#334155"/>
    <rect x="162" y="94" width="40" height="26" rx="6" fill="#EAB308"/>
  </g>
</svg>`;

// Preset 2: Wok & Golden Flame
const WOK_FLAME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgWok" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#991B1B"/><stop offset="50%" stop-color="#DC2626"/><stop offset="100%" stop-color="#EA580C"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgWok)"/>
  <circle cx="256" cy="256" r="200" fill="#FFFFFF" opacity="0.06"/>
  <!-- Flaming Fire -->
  <path d="M 256 90 C 230 140 200 170 200 215 C 200 245 225 270 256 270 C 287 270 312 245 312 215 C 312 170 282 140 256 90 Z" fill="#FBBF24"/>
  <path d="M 256 140 C 242 170 226 190 226 215 C 226 230 240 245 256 245 C 272 245 286 230 286 215 C 286 190 270 170 256 140 Z" fill="#F97316"/>
  <!-- Sizzling Wok Pan -->
  <path d="M 120 270 Q 256 420 392 270 Z" fill="#1E293B" stroke="#FBBF24" stroke-width="8"/>
  <!-- Handles -->
  <path d="M 120 275 C 90 275 80 295 100 305" stroke="#FBBF24" stroke-width="10" stroke-linecap="round" fill="none"/>
  <path d="M 392 275 C 422 275 432 295 412 305" stroke="#FBBF24" stroke-width="10" stroke-linecap="round" fill="none"/>
  <!-- Spatula / Turner -->
  <line x1="256" y1="210" x2="350" y2="340" stroke="#E2E8F0" stroke-width="8" stroke-linecap="round"/>
  <!-- Food Cost Currency Seal -->
  <circle cx="256" cy="385" r="42" fill="#FBBF24"/>
  <text x="256" y="399" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="40" fill="#7C2D12">฿</text>
</svg>`;

// Preset 3: Chef Knife & Cutting Board (Emerald Precision)
const CHEF_PRECISION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgPrec" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#065F46"/><stop offset="50%" stop-color="#059669"/><stop offset="100%" stop-color="#047857"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgPrec)"/>
  <!-- Cutting Board -->
  <rect x="106" y="106" width="300" height="300" rx="40" fill="#78350F" stroke="#D97706" stroke-width="8"/>
  <rect x="126" y="126" width="260" height="260" rx="30" fill="#B45309"/>
  <!-- Chef Cleaver / Knife -->
  <path d="M 170 170 L 320 170 C 340 170 340 240 320 270 L 170 270 Z" fill="#E2E8F0" stroke="#94A3B8" stroke-width="4"/>
  <rect x="130" y="200" width="45" height="40" rx="8" fill="#1E293B"/>
  <!-- Cost % Gauge Indicator -->
  <circle cx="256" cy="330" r="38" fill="#10B981" stroke="#FFFFFF" stroke-width="4"/>
  <text x="256" y="342" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="28" fill="#FFFFFF">%</text>
</svg>`;

// Preset 4: Steaming Rice & Bowl (Warm Claypot)
const RICE_BOWL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgBowl" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#C2410C"/><stop offset="50%" stop-color="#EA580C"/><stop offset="100%" stop-color="#FB923C"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgBowl)"/>
  <!-- Steaming trails -->
  <path d="M 210 110 Q 225 150 205 180" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.8"/>
  <path d="M 256 90 Q 270 140 250 180" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.9"/>
  <path d="M 302 110 Q 315 150 295 180" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.8"/>
  <!-- Rice Mound -->
  <ellipse cx="256" cy="245" rx="130" ry="70" fill="#FFFFFF"/>
  <!-- Bowl -->
  <path d="M 126 245 Q 256 410 386 245 Z" fill="#1E293B" stroke="#FBBF24" stroke-width="8"/>
  <!-- Chopsticks -->
  <line x1="140" y1="190" x2="380" y2="280" stroke="#D97706" stroke-width="8" stroke-linecap="round"/>
  <!-- Cost Control Badge -->
  <rect x="206" y="315" width="100" height="34" rx="10" fill="#FBBF24"/>
  <text x="256" y="338" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="18" fill="#0F172A">฿ COST</text>
</svg>`;

export const APP_ICON_PRESETS: AppIconPreset[] = [
  {
    id: 'default',
    nameTh: "Tony's Signature (หมวกเชฟ & เครื่องคิดเลข)",
    nameEn: "Tony's Signature Chef Hat & Calculator",
    descriptionTh: 'ไอคอนต้นตำรับ หมวกเชฟสีขาวพร้อมเครื่องคิดคำนวณต้นทุน และสัญลักษณ์เงินบาท ฿',
    category: 'culinary',
    svgDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_ICON_SVG)}`,
    themeColor: '#F27D26',
  },
  {
    id: 'wok_flame',
    nameTh: 'กระทะผัด & เปลวไฟทอง (Wok & Flame)',
    nameEn: 'Wok & Golden Flame Master',
    descriptionTh: 'เปลวไฟผัดอาหารสีทองและกระทะเหล็กสะท้อนความเชี่ยวชาญในครัว',
    category: 'culinary',
    svgDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(WOK_FLAME_SVG)}`,
    themeColor: '#DC2626',
  },
  {
    id: 'chef_precision',
    nameTh: 'มีดเชฟ & เขียงควบคุม (Precision Green)',
    nameEn: 'Chef Precision Cutting Board',
    descriptionTh: 'ความแม่นยำในการแล่และจัดการ Yield ทุกกรัมอย่างคุ้มค่า',
    category: 'culinary',
    svgDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(CHEF_PRECISION_SVG)}`,
    themeColor: '#059669',
  },
  {
    id: 'rice_bowl',
    nameTh: 'ชามข้าวสวย & ตะเกียบ (Steaming Rice Bowl)',
    nameEn: 'Steaming Rice Bowl',
    descriptionTh: 'ชามข้าวหอมมะลิร้อนๆ สื่อถึงอาหารจานเดียวและกับข้าวรสเลิศ',
    category: 'culinary',
    svgDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(RICE_BOWL_SVG)}`,
    themeColor: '#EA580C',
  },
];

export const AppIconService = {
  /**
   * Retrieves the currently active custom icon URL (data URI or preset)
   */
  getCurrentIcon(): string {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CUSTOM_ICON);
      if (saved) return saved;
    } catch {
      // ignore
    }
    return APP_ICON_PRESETS[0].svgDataUri;
  },

  /**
   * Retrieves active theme color
   */
  getCurrentThemeColor(): string {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CUSTOM_THEME);
      if (saved) return saved;
    } catch {
      // ignore
    }
    return '#F27D26';
  },

  /**
   * Sets a preset or custom image data URI as the active app icon
   */
  setCustomIcon(dataUri: string, themeColor: string = '#F27D26'): void {
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_ICON, dataUri);
      localStorage.setItem(STORAGE_KEY_CUSTOM_THEME, themeColor);
      this.applyIconToDocument(dataUri, themeColor);
    } catch (e) {
      console.error('Failed to save custom app icon:', e);
    }
  },

  /**
   * Resets app icon back to the default signature icon
   */
  resetToDefault(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_ICON);
      localStorage.removeItem(STORAGE_KEY_CUSTOM_THEME);
      this.applyIconToDocument(APP_ICON_PRESETS[0].svgDataUri, '#F27D26');
    } catch (e) {
      console.error('Failed to reset app icon:', e);
    }
  },

  /**
   * Dynamically applies the chosen icon to the HTML document links and meta tags
   */
  applyIconToDocument(iconUrl: string, themeColor: string = '#F27D26'): void {
    if (typeof document === 'undefined') return;

    // Update Favicon
    let favLink = document.getElementById('app-favicon-link') as HTMLLinkElement | null;
    if (!favLink) {
      favLink = document.createElement('link');
      favLink.id = 'app-favicon-link';
      favLink.rel = 'icon';
      document.head.appendChild(favLink);
    }
    favLink.href = iconUrl;

    // Update Apple Touch Icon
    let appleLink = document.getElementById('app-apple-touch-icon-link') as HTMLLinkElement | null;
    if (!appleLink) {
      appleLink = document.createElement('link');
      appleLink.id = 'app-apple-touch-icon-link';
      appleLink.rel = 'apple-touch-icon';
      document.head.appendChild(appleLink);
    }
    appleLink.href = iconUrl;

    // Update Theme Color
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', themeColor);
    }

    // Note: Web App Manifest must remain a static HTTPS URL with PNG icons for Android WebAPK validation.
    // iOS Safari dynamically reads apple-touch-icon above upon 'Add to Home Screen'.
  },
};
