import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  lang?: 'th' | 'en';
  variant?: 'danger' | 'warning' | 'primary';
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  lang: propLang,
  variant = 'danger',
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  if (!isOpen) return null;

  const resolvedConfirm = confirmLabel || (lang === 'en' ? 'Confirm Delete' : 'ยืนยันลบ');
  const resolvedCancel = cancelLabel || (lang === 'en' ? 'Cancel' : 'ยกเลิก');
  const loadingText = lang === 'en' ? 'Processing...' : 'กำลังดำเนินการ...';

  const isDanger = variant === 'danger';
  const isWarning = variant === 'warning';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-xs"
      onClick={() => {
        if (!isLoading) onCancel();
      }}
    >
      <div
        className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-neutral-200 text-neutral-900 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-neutral-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                isDanger
                  ? 'bg-rose-50 text-rose-600'
                  : isWarning
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-orange-50 text-orange-600'
              }`}
            >
              {isDanger ? <Trash2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            </span>
            <h3 className="font-black text-sm text-neutral-900 truncate">{title}</h3>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="p-1 rounded-xl text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer shrink-0 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-neutral-600 leading-relaxed">{message}</p>

        <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="px-3.5 py-2 bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            {resolvedCancel}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={`px-4 py-2 text-white rounded-xl text-xs font-black shadow-md cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20'
                : isWarning
                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-500/20'
                : 'bg-gradient-to-r from-orange-500 to-red-500 shadow-orange-500/20'
            }`}
          >
            {isDanger && <Trash2 className="w-3.5 h-3.5" />}
            <span>{isLoading ? loadingText : resolvedConfirm}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
