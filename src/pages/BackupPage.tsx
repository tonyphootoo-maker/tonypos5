import React, { useState } from 'react';
import { SettingsDoc, Language } from '../types';
import { translations } from '../i18n/translations';
import { exportFullDatabase, importFullDatabase } from '../data/db';
import {
  DatabaseBackup,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Loader2,
} from 'lucide-react';

interface Props {
  settings: SettingsDoc;
  lang: Language;
}

export const BackupPage: React.FC<Props> = ({ settings, lang }) => {
  const t = translations[lang];

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setExportSuccess(false);
    setErrorMessage(null);
    try {
      const data = await exportFullDatabase();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `KinPOS_Full_Backup_${timestamp}.json`;

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
    } catch (err: unknown) {
      console.error('Export error:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(t.backup.restoreWarning)) {
      e.target.value = '';
      return;
    }

    setIsImporting(true);
    setImportSuccess(false);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.onerror = () => {
      setErrorMessage('Failed to read file');
      setIsImporting(false);
    };
    reader.onload = async (event) => {
      try {
        const jsonContent = event.target?.result as string;
        const parsed = JSON.parse(jsonContent);
        await importFullDatabase(parsed);
        setImportSuccess(true);
      } catch (err: unknown) {
        console.error('Import error:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Invalid JSON backup format');
      } finally {
        setIsImporting(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6 select-none">
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight flex items-center gap-2">
          <DatabaseBackup className="w-6 h-6 text-blue-600" />
          <span>{t.backup.title}</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-1">{t.backup.description}</p>
      </div>

      {/* Notifications */}
      {exportSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-800 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{t.backup.exportSuccess}</span>
        </div>
      )}

      {importSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-800 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{t.backup.importSuccess}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-2xl text-rose-800 text-xs font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Export Card */}
        <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-base text-neutral-900">
              {t.backup.exportTitle}
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed">
              {t.backup.exportNote} Includes all 18 collections: settings, recipes, dishes, floor plans, sales history, daily summaries, images, and expenses.
            </p>
          </div>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 active:scale-98 cursor-pointer hover:brightness-105 disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <FileJson className="w-4 h-4" />
                <span>{t.backup.exportBtn}</span>
              </>
            )}
          </button>
        </div>

        {/* Import Card */}
        <div className="p-5 bg-white rounded-3xl border border-neutral-200 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-base text-neutral-900">
              {t.backup.importTitle}
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Restores a previously exported JSON backup file. All database documents and compressed images are synchronized.
            </p>
          </div>

          <div>
            <label className="w-full py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 shadow-md active:scale-98 cursor-pointer">
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Restoring Database...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>{t.backup.chooseFile}</span>
                </>
              )}
              <input
                type="file"
                accept=".json,application/json"
                disabled={isImporting}
                onChange={handleFileImport}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
