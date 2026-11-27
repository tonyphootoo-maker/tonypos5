import { describe, expect, it } from 'vitest';
import { isDynamicImportError } from '../lazyWithRetry';

describe('lazyWithRetry helpers', () => {
  it('detects transient dynamic ES module and chunk fetch failures accurately', () => {
    expect(
      isDynamicImportError(
        new TypeError('Failed to fetch dynamically imported module: https://example.com/src/App.tsx')
      )
    ).toBe(true);
    expect(isDynamicImportError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isDynamicImportError(new Error('Loading chunk 14 failed.'))).toBe(true);
    expect(isDynamicImportError(new Error('504 (Outdated Optimize Dep)'))).toBe(true);
    expect(isDynamicImportError(new Error('Permission denied'))).toBe(false);
    expect(isDynamicImportError(null)).toBe(false);
  });
});
