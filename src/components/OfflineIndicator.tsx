import React from 'react';
import { WifiOff } from 'lucide-react';
import { Language } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface Props {
  lang?: Language;
}

export const OfflineIndicator: React.FC<Props> = ({ lang: propLang }) => {
  const isOnline = useOnlineStatus();
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg border border-amber-400/50"
    >
      <span className="h-2 w-2 rounded-full bg-white animate-pulse shrink-0" />
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>
        {lang === 'th'
          ? 'โหมดออฟไลน์ — กำลังใช้งานข้อมูลแคชในเครื่อง'
          : 'Offline Mode — Cached data is being used'}
      </span>
    </div>
  );
};
