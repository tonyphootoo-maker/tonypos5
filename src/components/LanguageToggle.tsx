import React from 'react';
import { Globe } from 'lucide-react';
import { Language } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface LanguageToggleProps {
  lang?: Language;
  onToggleLang?: () => void;
  variant?: 'light' | 'dark' | 'header-accent';
  className?: string;
}

export const LanguageToggle: React.FC<LanguageToggleProps> = ({
  lang: propLang,
  onToggleLang: propOnToggleLang,
  variant = 'light',
  className = '',
}) => {
  const { lang: ctxLang, setLang, toggleLang } = useLanguage();
  const activeLang = propLang ?? ctxLang;

  const handleChoose = (target: Language) => {
    if (target === activeLang) return;
    if (propOnToggleLang) {
      propOnToggleLang();
    } else {
      setLang(target);
    }
  };

  const handleCycle = () => {
    if (propOnToggleLang) {
      propOnToggleLang();
    } else {
      toggleLang();
    }
  };

  if (variant === 'dark') {
    return (
      <div
        role="group"
        aria-label={activeLang === 'th' ? 'เปลี่ยนภาษา' : 'Switch language'}
        className={`inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-800 border border-slate-700 text-[11px] font-bold shrink-0 ${className}`}
      >
        <button
          type="button"
          onClick={handleCycle}
          aria-label={activeLang === 'th' ? 'สลับภาษา ไทย / อังกฤษ' : 'Toggle Thai / English'}
          className="px-1.5 py-1 text-slate-300 hover:text-white cursor-pointer flex items-center"
        >
          <Globe className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleChoose('th')}
          className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
            activeLang === 'th'
              ? 'bg-emerald-500 text-slate-950 font-extrabold'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          ไทย
        </button>
        <button
          type="button"
          onClick={() => handleChoose('en')}
          className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
            activeLang === 'en'
              ? 'bg-emerald-500 text-slate-950 font-extrabold'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          EN
        </button>
      </div>
    );
  }

  if (variant === 'header-accent') {
    return (
      <div
        role="group"
        aria-label={activeLang === 'th' ? 'เปลี่ยนภาษา' : 'Switch language'}
        className={`inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-white/15 border border-white/30 text-[11px] font-bold shrink-0 ${className}`}
      >
        <button
          type="button"
          onClick={() => handleChoose('th')}
          className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
            activeLang === 'th'
              ? 'bg-white text-orange-700 font-extrabold shadow-2xs'
              : 'text-white/90 hover:bg-white/15'
          }`}
        >
          ไทย
        </button>
        <button
          type="button"
          onClick={() => handleChoose('en')}
          className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
            activeLang === 'en'
              ? 'bg-white text-orange-700 font-extrabold shadow-2xs'
              : 'text-white/90 hover:bg-white/15'
          }`}
        >
          EN
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={activeLang === 'th' ? 'เปลี่ยนภาษา' : 'Switch language'}
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold shadow-[0_2px_0_#e2e8f0] shrink-0 ${className}`}
    >
      <button
        type="button"
        onClick={handleCycle}
        title={activeLang === 'th' ? 'สลับภาษา ไทย / อังกฤษ' : 'Toggle Thai / English'}
        aria-label={activeLang === 'th' ? 'สลับภาษา ไทย / อังกฤษ' : 'Toggle Thai / English'}
        className="px-1.5 py-1 text-slate-500 hover:text-orange-600 cursor-pointer flex items-center"
      >
        <Globe className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => handleChoose('th')}
        className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
          activeLang === 'th'
            ? 'bg-orange-600 text-white font-extrabold shadow-2xs'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
        }`}
      >
        ไทย
      </button>
      <button
        type="button"
        onClick={() => handleChoose('en')}
        className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
          activeLang === 'en'
            ? 'bg-orange-600 text-white font-extrabold shadow-2xs'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
        }`}
      >
        EN
      </button>
    </div>
  );
};
