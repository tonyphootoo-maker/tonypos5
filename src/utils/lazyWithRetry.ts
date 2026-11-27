import React from 'react';

const CHUNK_RELOAD_STORAGE_KEY = 'kinpos_chunk_reload_ts';
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

export function isDynamicImportError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : String(error ?? '');
  const normalized = msg.toLowerCase();
  return (
    normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('importing a module script failed') ||
    normalized.includes('error loading dynamically imported module') ||
    normalized.includes('loading chunk') ||
    normalized.includes('loading css chunk') ||
    normalized.includes('outdated optimize dep')
  );
}

export async function unregisterStaleServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Ignore storage/SW permission errors in restricted WebViews
  }
}

function trySingleAutoReload(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const now = Date.now();
    const rawLast = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    const lastTs = rawLast ? Number(rawLast) : 0;
    if (!Number.isFinite(lastTs) || now - lastTs > CHUNK_RELOAD_COOLDOWN_MS) {
      window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
  return false;
}

export function clearChunkReloadGuard(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
  } catch {
    // Ignore sessionStorage restrictions
  }
}

export function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  delaysMs: number[] = [600, 1400, 2600]
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
      try {
        const mod = await importer();
        clearChunkReloadGuard();
        return mod;
      } catch (err) {
        lastError = err;
        if (attempt < delaysMs.length) {
          await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
        }
      }
    }

    if (isDynamicImportError(lastError)) {
      await unregisterStaleServiceWorkers();
      if (trySingleAutoReload()) {
        // Keep promise pending briefly while browser executes reload
        return await new Promise<{ default: T }>(() => {});
      }
    }

    throw lastError;
  });
}
