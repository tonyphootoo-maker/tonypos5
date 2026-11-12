import React, { useEffect, useState } from 'react';
import { SyncStatus, Language } from '../types';
import { translations } from '../i18n/translations';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

interface Props {
  lang: Language;
}

export const OnlineStatusBadge: React.FC<Props> = ({ lang }) => {
  const [status, setStatus] = useState<SyncStatus>(navigator.onLine ? 'online' : 'offline');
  const t = translations[lang];

  useEffect(() => {
    const handleOnline = () => {
      setStatus('syncing');
      setTimeout(() => setStatus('online'), 2000);
    };
    const handleOffline = () => setStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shadow-xs transition-colors duration-200 border ${
        status === 'online'
          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
          : status === 'syncing'
          ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse'
          : 'bg-rose-50 text-rose-800 border-rose-300'
      }`}
      title={t.sync[status]}
    >
      {status === 'online' && <Wifi className="w-3.5 h-3.5 text-emerald-600" />}
      {status === 'syncing' && <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />}
      {status === 'offline' && <WifiOff className="w-3.5 h-3.5 text-rose-600" />}
      <span className="hidden sm:inline">{t.sync[status]}</span>
    </div>
  );
};
