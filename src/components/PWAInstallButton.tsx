import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Smartphone, Tablet, Share, PlusSquare, MoreVertical, CheckCircle2, X } from 'lucide-react';
import { Language } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface Props {
  lang?: Language;
  variant?: 'header' | 'button' | 'card' | 'rider-banner';
  appName?: string;
  theme?: 'orange' | 'emerald';
  onActionTaken?: () => void;
}

export const PWAInstallButton: React.FC<Props> = ({
  lang: propLang,
  variant = 'header',
  appName = "Tony's Kit",
  theme = 'orange',
  onActionTaken,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const { isInstallable, isInstalled, isIOS, isAndroid, isInAppBrowser, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [guideTab, setGuideTab] = useState<'android' | 'ios' | 'desktop'>(() =>
    isIOS ? 'ios' : isAndroid ? 'android' : 'desktop'
  );

  const isRiderTheme = theme === 'emerald' || variant === 'rider-banner';

  // If already running as an installed standalone PWA on Tablet / POS / Phone
  if (isInstalled) {
    if (variant === 'card') {
      return (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-900">
          <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-extrabold">
              {lang === 'th' ? `ติดตั้งแอป ${appName} บนเครื่องนี้แล้ว` : `${appName} App Installed`}
            </div>
            <p className="text-xs text-emerald-700 mt-0.5">
              {lang === 'th'
                ? 'คุณกำลังใช้งานแอปแบบเต็มหน้าจอ (Standalone) พร้อมระบบแคชออฟไลน์'
                : 'Running in full-screen standalone app mode with offline asset caching.'}
            </p>
          </div>
        </div>
      );
    }
    return null;
  }

  const openGuideFor = (tab?: 'ios' | 'android' | 'desktop') => {
    setGuideTab(tab ?? (isIOS ? 'ios' : isAndroid ? 'android' : 'desktop'));
    setShowGuideModal(true);
  };

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      onActionTaken?.();
      if (accepted) return;
    }
    openGuideFor();
  };

  // Show guide button on iOS/iPadOS, Android, anytime variant is 'card'/'button'/'rider-banner', or emerald Rider theme
  const shouldRenderTrigger =
    isInstallable ||
    isIOS ||
    isAndroid ||
    variant === 'card' ||
    variant === 'button' ||
    variant === 'rider-banner' ||
    isRiderTheme;

  if (!shouldRenderTrigger) {
    return null;
  }

  const isCustomApp = appName !== "Tony's Kit";
  const isRiderApp = appName.toLowerCase().includes('rider');
  const labelText =
    lang === 'th'
      ? isInstallable
        ? 'ติดตั้งแอป'
        : isIOS
          ? isCustomApp
            ? 'ติดตั้ง iOS'
            : 'ติดตั้ง iPad/iOS'
          : isCustomApp
            ? 'ติดตั้งแอป'
            : 'ติดตั้งแอป POS'
      : isRiderApp
        ? isIOS && !isInstallable
          ? 'Install Rider App (iOS)'
          : 'Install Rider App'
        : isInstallable
          ? 'Install App'
          : isIOS
            ? 'Install iOS'
            : 'Install App';

  const headerGrad = isRiderTheme
    ? 'from-emerald-600 to-teal-700'
    : 'from-orange-500 to-red-500';
  const badgeBg = isRiderTheme ? 'bg-emerald-600' : 'bg-orange-500';
  const infoBg = isRiderTheme
    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
    : 'bg-orange-50 border-orange-200 text-orange-900';
  const iconAccent = isRiderTheme ? 'text-emerald-600' : 'text-orange-600';

  const guideModal =
    showGuideModal && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-950/75 backdrop-blur-xs">
            <div
              className={`modal-panel bg-white rounded-3xl shadow-2xl max-w-md w-full border text-neutral-900 ${
                isRiderTheme ? 'border-emerald-200' : 'border-orange-200'
              }`}
            >
              <div className={`modal-header bg-gradient-to-r ${headerGrad} text-white flex items-center justify-between`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Smartphone className="w-5 h-5 shrink-0" />
                  <h3 className="font-extrabold text-base truncate">
                    {lang === 'th'
                      ? `ติดตั้ง ${appName} ลงบนมือถือ`
                      : `Install ${appName} App`}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="modal-body space-y-4 text-xs">
                {/* Switch between Android, iOS & Desktop guides */}
                <div className="grid grid-cols-3 gap-1 p-1 bg-neutral-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setGuideTab('android')}
                    className={`py-2 px-2 rounded-lg font-extrabold cursor-pointer transition-colors ${
                      guideTab === 'android'
                        ? isRiderTheme
                          ? 'bg-emerald-600 text-white'
                          : 'bg-orange-500 text-white'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    Android
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuideTab('ios')}
                    className={`py-2 px-2 rounded-lg font-extrabold cursor-pointer transition-colors ${
                      guideTab === 'ios'
                        ? isRiderTheme
                          ? 'bg-emerald-600 text-white'
                          : 'bg-orange-500 text-white'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    iOS / iPad
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuideTab('desktop')}
                    className={`py-2 px-2 rounded-lg font-extrabold cursor-pointer transition-colors ${
                      guideTab === 'desktop'
                        ? isRiderTheme
                          ? 'bg-emerald-600 text-white'
                          : 'bg-orange-500 text-white'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {lang === 'th' ? 'คอม / Mac' : 'Desktop'}
                  </button>
                </div>

                {isInAppBrowser && (
                  <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 font-bold leading-relaxed">
                    {lang === 'th'
                      ? 'คุณกำลังเปิดผ่านเบราว์เซอร์ในแอป (เช่น LINE) — กรุณากดเปิดลิงก์นี้ใน Safari (สำหรับ iOS) หรือ Google Chrome (สำหรับ Android) ก่อนจึงจะติดตั้งเป็นแอปได้สมบูรณ์'
                      : 'Opened inside an in-app browser (e.g. LINE). Open this URL in Safari (iOS) or Google Chrome (Android) first to install as a full standalone app.'}
                  </div>
                )}

                {guideTab === 'android' && isInstallable && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await install();
                      if (ok) setShowGuideModal(false);
                      onActionTaken?.();
                    }}
                    className={`w-full py-3 rounded-xl text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer ${
                      isRiderTheme ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-orange-500 hover:bg-orange-600'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {lang === 'th'
                        ? `กดติดตั้ง ${appName} บน Android ทันที`
                        : `Install ${appName} Now (One-Tap)`}
                    </span>
                  </button>
                )}

                {guideTab === 'ios' ? (
                  <div className="space-y-3">
                    <div className={`p-3 border rounded-2xl font-bold flex items-center gap-2 ${infoBg}`}>
                      <Smartphone className={`w-4 h-4 shrink-0 ${iconAccent}`} />
                      <span>
                        {lang === 'th'
                          ? `วิธีติดตั้ง ${appName} บน iPhone / iPad (เปิดด้วย Safari)`
                          : `iPhone / iPad Installation Steps (Safari)`}
                      </span>
                    </div>
                    <ol className="space-y-2.5 text-neutral-700 leading-relaxed">
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          1
                        </span>
                        <span>
                          {lang === 'th' ? (
                            <>
                              เปิดลิงก์นี้ด้วยแอป <strong>Safari</strong> แล้วแตะปุ่ม{' '}
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-300 font-bold">
                                <Share className="w-3 h-3 text-blue-600" /> แชร์ (Share)
                              </span>{' '}
                              ที่แถบด้านล่างหรือด้านบนของหน้าจอ
                            </>
                          ) : (
                            <>
                              Open this page in <strong>Safari</strong> and tap the{' '}
                              <strong>Share</strong> icon in the toolbar.
                            </>
                          )}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          2
                        </span>
                        <span>
                          {lang === 'th' ? (
                            <>
                              เลื่อนลงแล้วแตะ{' '}
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-300 font-bold">
                                <PlusSquare className="w-3 h-3 text-neutral-700" /> เพิ่มไปยังหน้าจอโฮม
                              </span>{' '}
                              (Add to Home Screen)
                            </>
                          ) : (
                            <>
                              Scroll down and tap <strong>Add to Home Screen</strong>.
                            </>
                          )}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          3
                        </span>
                        <span>
                          {lang === 'th'
                            ? `แตะ "เพิ่ม (Add)" มุมขวาบน จากนั้นเปิดใช้งานจากไอคอน ${appName} บนหน้าจอหลักได้แบบเต็มจอทันที`
                            : `Tap "Add" in the top-right corner, then launch ${appName} directly from your Home Screen.`}
                        </span>
                      </li>
                    </ol>
                  </div>
                ) : guideTab === 'desktop' ? (
                  <div className="space-y-3">
                    <div className={`p-3 border rounded-2xl font-bold flex items-center gap-2 ${infoBg}`}>
                      <Tablet className={`w-4 h-4 shrink-0 ${iconAccent}`} />
                      <span>
                        {lang === 'th'
                          ? `วิธีติดตั้ง ${appName} บนคอมพิวเตอร์ (Chrome / Edge)`
                          : `Desktop Installation Steps (Chrome / Edge)`}
                      </span>
                    </div>
                    {isInstallable && (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await install();
                          if (ok) setShowGuideModal(false);
                          onActionTaken?.();
                        }}
                        className={`w-full py-3 rounded-xl text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer ${
                          isRiderTheme ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-orange-500 hover:bg-orange-600'
                        }`}
                      >
                        <Download className="w-4 h-4" />
                        <span>
                          {lang === 'th' ? `ติดตั้ง ${appName} ทันที` : `Install ${appName} Now`}
                        </span>
                      </button>
                    )}
                    <ol className="space-y-2.5 text-neutral-700 leading-relaxed">
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          1
                        </span>
                        <span>
                          {lang === 'th'
                            ? 'เปิดเว็บไซต์นี้ในแท็บเต็ม (นอกกรอบพรีวิว) ด้วย Google Chrome หรือ Microsoft Edge'
                            : 'Open this app directly in a full Google Chrome or Microsoft Edge tab.'}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          2
                        </span>
                        <span>
                          {lang === 'th'
                            ? 'คลิกไอคอนติดตั้งแอป (⊕) ทางด้านขวาของแถบที่อยู่เว็บ (Address bar) หรือเข้าเมนู ⋮ > บันทึกและแชร์ > ติดตั้งแอป'
                            : 'Click the Install icon on the right side of the address bar, or open ⋮ Menu > Save and share > Install app.'}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          3
                        </span>
                        <span>
                          {lang === 'th'
                            ? `ยืนยัน "ติดตั้ง (Install)" แอป ${appName} จะเปิดเป็นหน้าต่างแยกเหมือนโปรแกรมบนเครื่องและแคชออฟไลน์ให้อัตโนมัติ`
                            : `Click "Install" to launch ${appName} in its own standalone app window with offline caching.`}
                        </span>
                      </li>
                    </ol>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className={`p-3 border rounded-2xl font-bold flex items-center gap-2 ${infoBg}`}>
                      <Tablet className={`w-4 h-4 shrink-0 ${iconAccent}`} />
                      <span>
                        {lang === 'th'
                          ? `วิธีติดตั้ง ${appName} บนมือถือ Android (Chrome / Edge)`
                          : `Android Installation Steps (Chrome / Edge)`}
                      </span>
                    </div>
                    <ol className="space-y-2.5 text-neutral-700 leading-relaxed">
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          1
                        </span>
                        <span>
                          {lang === 'th' ? (
                            <>
                              เปิดหน้านี้ด้วยเบราว์เซอร์ <strong>Google Chrome</strong> หรือ <strong>Edge</strong> บนมือถือ Android
                            </>
                          ) : (
                            <>
                              Open this page in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on your Android device.
                            </>
                          )}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          2
                        </span>
                        <span>
                          {lang === 'th' ? (
                            <>
                              แตะปุ่มเมนู{' '}
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-300 font-bold">
                                <MoreVertical className="w-3 h-3" /> จุดสามจุด
                              </span>{' '}
                              มุมขวาบน แล้วเลือก <strong>"ติดตั้งแอป" (Install app)</strong> หรือ{' '}
                              <strong>"เพิ่มลงในหน้าจอหลัก" (Add to Home screen)</strong>
                            </>
                          ) : (
                            <>
                              Tap the <strong>⋮ Menu</strong> button in the top-right corner and select{' '}
                              <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                            </>
                          )}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full ${badgeBg} text-white font-black flex items-center justify-center shrink-0 text-[11px]`}>
                          3
                        </span>
                        <span>
                          {lang === 'th'
                            ? `กด "ติดตั้ง (Install)" ไอคอนแอป ${appName} จะปรากฏบนหน้าจอหลักสำหรับเปิดรับงานและนำทางเต็มจอ`
                            : `Tap "Install" to add the ${appName} icon to your Home Screen for full-screen delivery & navigation.`}
                        </span>
                      </li>
                    </ol>
                  </div>
                )}

              </div>

              <div className="modal-footer bg-white border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-extrabold cursor-pointer"
                >
                  {lang === 'th' ? 'เข้าใจแล้ว / ปิด' : 'Got it / Close'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  if (variant === 'rider-banner') {
    return (
      <>
        <div className="p-3.5 rounded-2xl bg-slate-900 border border-emerald-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-white truncate">
                {lang === 'th'
                  ? `ติดตั้งแอป ${appName} บนมือถือ (Android / iOS)`
                  : `Install ${appName} Mobile App (Android / iOS)`}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {lang === 'th'
                  ? 'เปิดใช้งานรับงานและนำทางเต็มหน้าจอได้ทันทีจากหน้าจอหลัก'
                  : 'Launch full-screen delivery dispatch & navigation from your home screen'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClick}
              className="flex-1 sm:flex-initial min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>
                {lang === 'th'
                  ? isInstallable
                    ? 'ติดตั้ง Android ทันที'
                    : 'ติดตั้งแอป Android / iOS'
                  : isRiderApp
                    ? 'Install Rider App'
                    : 'Install App'}
              </span>
            </button>
            {isInstallable && (
              <button
                type="button"
                onClick={() => openGuideFor('ios')}
                className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
              >
                iOS
              </button>
            )}
          </div>
        </div>
        {guideModal}
      </>
    );
  }

  if (variant === 'card') {
    return (
      <>
        <div className="p-4 bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-orange-500 text-white shadow-xs shrink-0">
              <Tablet className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-extrabold text-neutral-900">
              {lang === 'th'
                ? 'ติดตั้งแอปลงเครื่อง Tablet และ POS (Android / iOS)'
                : 'Install App on Tablet & POS (Android / iOS)'}
            </h4>
          </div>
          <button
            type="button"
            onClick={handleClick}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:brightness-105 text-white rounded-xl text-xs font-black shadow-md shadow-orange-500/20 flex items-center justify-center gap-1.5 cursor-pointer shrink-0 active:scale-95 transition-all"
          >
            <Download className="w-4 h-4" />
            <span>{labelText}</span>
          </button>
        </div>
        {guideModal}
      </>
    );
  }

  if (variant === 'button') {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
            isRiderTheme
              ? 'bg-emerald-500 hover:bg-emerald-400 border-emerald-400 text-slate-950 font-extrabold'
              : 'bg-orange-50 hover:bg-orange-100 border-orange-300 text-orange-700 shadow-xs'
          }`}
        >
          <Download className={`w-3.5 h-3.5 ${isRiderTheme ? 'text-slate-950' : 'text-orange-600'}`} />
          <span>{labelText}</span>
        </button>
        {guideModal}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={labelText}
        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs active:scale-95 transition-all cursor-pointer ${
          isRiderTheme
            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold'
            : 'bg-gradient-to-r from-orange-500 to-red-500 hover:brightness-105 text-white'
        }`}
      >
        <Download className="w-3.5 h-3.5" />
        <span className={isRiderTheme ? 'inline' : 'hidden md:inline'}>{labelText}</span>
      </button>
      {guideModal}
    </>
  );
};
