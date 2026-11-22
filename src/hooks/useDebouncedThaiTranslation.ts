import { useEffect, useRef } from 'react';
import { containsThaiCharacters } from '../utils/thaiToEnglish';

export interface DebouncedTranslationScheduler {
  schedule: (key: string, fn: () => void) => void;
  flush: (key: string, fallbackFn?: () => void) => void;
  cancel: (key: string) => void;
  cancelAll: () => void;
  hasPending: (key: string) => boolean;
}

/**
 * Pure debounced translation scheduler (default 600 ms).
 * Supports per-field scheduling, immediate flush on blur/save, and clean cancellation.
 */
export function createDebouncedTranslationScheduler(delayMs = 600): DebouncedTranslationScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const callbacks = new Map<string, () => void>();

  const cancel = (key: string) => {
    const existing = timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
      timers.delete(key);
    }
    callbacks.delete(key);
  };

  const schedule = (key: string, fn: () => void) => {
    const existing = timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    callbacks.set(key, fn);
    const handle = setTimeout(() => {
      timers.delete(key);
      const cb = callbacks.get(key);
      callbacks.delete(key);
      if (cb) cb();
    }, delayMs);
    timers.set(key, handle);
  };

  const flush = (key: string, fallbackFn?: () => void) => {
    const existing = timers.get(key);
    const pendingCb = callbacks.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
      timers.delete(key);
    }
    callbacks.delete(key);
    if (pendingCb) {
      pendingCb();
    } else if (fallbackFn) {
      fallbackFn();
    }
  };

  const cancelAll = () => {
    for (const handle of timers.values()) {
      clearTimeout(handle);
    }
    timers.clear();
    callbacks.clear();
  };

  const hasPending = (key: string) => timers.has(key);

  return { schedule, flush, cancel, cancelAll, hasPending };
}

/**
 * React hook wrapping `createDebouncedTranslationScheduler(600)` with automatic unmount cleanup.
 */
export function useDebouncedTranslationScheduler(delayMs = 600): DebouncedTranslationScheduler {
  const schedulerRef = useRef<DebouncedTranslationScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createDebouncedTranslationScheduler(delayMs);
  }

  useEffect(() => {
    return () => {
      schedulerRef.current?.cancelAll();
    };
  }, []);

  return schedulerRef.current;
}

/**
 * Returns true when the Thai text cannot currently be represented by a clean non-Thai English name.
 */
export function needsEnglishReview(
  thaiText?: string | null,
  englishText?: string | null
): boolean {
  const th = (thaiText || '').trim();
  const en = (englishText || '').trim();
  if (!th || !containsThaiCharacters(th)) return false;
  return !en || containsThaiCharacters(en);
}
