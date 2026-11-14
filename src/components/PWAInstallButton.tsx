import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Smartphone, Tablet, Share, PlusSquare, MoreVertical, CheckCircle2, X } from 'lucide-react';
import { Language } from '../types';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface Props {
  lang: Language;
  variant?: 'header' | 'button' | 'card';
  onActionTaken?: () => void;
}

export const PWAInstallButton: React.FC<Props> = ({
  lang,
  variant = 'header',
  onActionTaken,
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

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
              {lang === 'th' ? 'ติดตั้งแอป KinPOS บนเครื่องนี้แล้ว' : 'KinPOS App Installed'}
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

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      onActionTaken?.();
      return;
    }
    setShowGuideModal(true);
  };

  // Show guide button on iOS/iPadOS, Android, or anytime variant is 'card' (in Settings) or 'button' (Login)
  const shouldRenderTrigger =
    isInstallable || isIOS || isAndroid || variant === 'card' || variant === 'button';

  if (!shouldRenderTrigger) {
    return null;
  }

  const labelText =
    lang === 'th'
      ? isInstallable
        ? 'ติดตั้งแอป'
        : isIOS
          ? 'ติดตั้ง iPad/iOS'
          : 'ติดตั้งแอป POS'
      : isInstallable
        ? 'Install App'
        : isIOS
          ? 'Install iOS'
          : 'Install App';

  const guideModal =
    showGuideModal && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-950/70 backdrop-blur-xs">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-orange-200 overflow-hidden text-neutral-900">
              <div className="p-4 bg-gradient-to-r from-orange-500 to-red-500 text-white flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Tablet className="w-5 h-5" />
                  <div>
                    <h3 className="font-extrabold text-base">
                      {lang === 'th'
                        ? 'ติดตั้ง KinPOS ลงเครื่อง Tablet / POS'
                        : 'Install KinPOS on Tablet / POS'}
                    </h3>
                    <p className="text-[11px] text-orange-100">
                      {lang === 'th'
                        ? 'เปิดใช้งานแบบแอปเต็มหน้าจอ ไม่ต้องผ่านแถบเบราว์เซอร์'
                        : 'Run full-screen like a native app on Android & iOS'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                {isIOS ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-orange-50 border border-orange-200 rounded-2xl font-bold text-orange-900 flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-orange-600 shrink-0" />
                      <span>
                        {lang === 'th'
                          ? 'วิธีติดตั้งสำหรับ iPad / iPhone (เปิดด้วย Safari)'
                          : 'iPad / iPhone Installation Steps (Safari)'}
                      </span>
                    </div>
                    <ol className="space-y-2.5 text-neutral-700 leading-relaxed">
                      <li className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-orange-500 text-white font-black flex items-center justify-center shrink-0 text-[11px]">
                          1
                        </span>
                        <span>
                          {lang === 'th' ? (
                            <>
                              เปิดหน้านี้ด้วย <strong>Safari</strong> แล้วแตะปุ่ม{' '}
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-300 font-bold">
                                <Share className="w-3 h-3 text-blue-600" /> แชร์ (Share)
                              </span>{' '}
                              ที่แถบเครื่องมือด้านบนหรือด้านล่าง
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
                        <span className="w-5 h-5 rounded-full bg-orange-500 text-white font-black flex items-center justify-center shrink-0 text-[11px]">
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
                        <span className="w-5 h-5 rounded-full bg-orange-500 text-white font-black flex items-center justify-center shrink-0 text-[11px]">
                          3
                        </span>
                        <span>
                          {lang === 'th'
                            ? 'แตะปุ่ม "เพิ่ม (Add)" มุมขวาบน จากนั้นเปิดใช้งานจากไอคอน KinPOS บนหน้าจอหลักได้ทันที'
                            : 'Tap "Add" in the top-right corner, then launch KinPOS directly from your Home Screen.'}
                        </span>
                      </li>
                    </ol>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 bg-orange-50 border border-orange-200 rounded-2xl font-bold text-orange-900 flex items-center gap-2">
                      <Tablet className="w-4 h-4 text-orange-600 shrink-0" />
                      <span>
                        {lang === 'th'
                          ? 'วิธีติดตั้งสำหรับ Tablet / เครื่อง POS ระบบ Android (Chrome / Edge)'
                          : 'Android Tablet / POS Installation Steps (Chrome / Edge)'}
                      </span>
                    </div>
                    <ol className="space-y-2.5 text-neutral-700 leading-relaxed">
                      <li className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-orange-500 text-white font-black flex items-center justify-center shrink-0 text-[11px]">
                          1
                        </span>
                        <span>
                          {lang === 'th' ? (
                            <>
                              เปิดหน้านี้ด้วยเบราว์เซอร์ <strong>Google Chrome</strong> หรือ <strong>Edge</strong> บนเครื่อง Android POS / Tablet
                            </>
                          ) : (
                            <>
                              Open this app in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on your Android POS or Tablet.
                            </>
                          )}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-orange-500 text-white font-black flex items-center justify-center shrink-0 text-[11px]">
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
                        <span className="w-5 h-5 rounded-full bg-orange-500 text-white font-black flex items-center justify-center shrink-0 text-[11px]">
                          3
                        </span>
                        <span>
                          {lang === 'th'
                            ? 'กด "ติดตั้ง (Install)" แอป KinPOS จะปรากฏบนหน้าจอเครื่อง POS และเปิดใช้งานเต็มจอได้ทันที'
                            : 'Tap "Install" to add the KinPOS icon to your POS/Tablet launcher for full-screen use.'}
                        </span>
                      </li>
                    </ol>
                  </div>
                )}

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

  if (variant === 'card') {
    return (
      <>
        <div className="p-4 bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-orange-500 text-white shadow-xs shrink-0">
              <Tablet className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-neutral-900">
                {lang === 'th'
                  ? 'ติดตั้งแอปลงเครื่อง Tablet และ POS (Android / iOS)'
                  : 'Install App on Tablet & POS (Android / iOS)'}
              </h4>
              <p className="text-xs text-neutral-600 mt-0.5">
                {lang === 'th'
                  ? 'ใช้งานแบบแอปเต็มหน้าจอ (Standalone) เข้าถึงไวจากหน้าจอหลัก และรองรับแคชออฟไลน์'
                  : 'Use full-screen standalone app mode directly from your home screen with offline caching.'}
              </p>
            </div>
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
          className="px-3 py-1.5 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 border border-orange-400/40 text-orange-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer backdrop-blur-md"
        >
          <Download className="w-3.5 h-3.5 text-orange-300" />
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
        className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 hover:brightness-105 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs active:scale-95 transition-all cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden md:inline">{labelText}</span>
      </button>
      {guideModal}
    </>
  );
};
