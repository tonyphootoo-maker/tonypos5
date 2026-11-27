import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __pwaDeferredPrompt?: BeforeInstallPromptEvent | null;
  }
}

function readWindowDeferredPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null;
  return window.__pwaDeferredPrompt ?? null;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const isStandaloneMedia =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches);
  const isIOSStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return isStandaloneMedia || isIOSStandalone;
}

function detectPlatformFlags() {
  if (typeof window === 'undefined') {
    return { isIOS: false, isAndroid: false, isInAppBrowser: false };
  }
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIOSDevice =
    /iphone|ipad|ipod/.test(userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  const isAndroidDevice = /android/.test(userAgent);
  const inApp = /\bline\/|fban|fbav|instagram|micromessenger/.test(userAgent);
  return { isIOS: isIOSDevice, isAndroid: isAndroidDevice, isInAppBrowser: inApp };
}

// Capture early beforeinstallprompt / appinstalled globally so lazy drawers or modals
// mounted after initial boot still retain access to the native install prompt.
let globalDeferredPrompt: BeforeInstallPromptEvent | null = readWindowDeferredPrompt();
const promptSubscribers = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    window.__pwaDeferredPrompt = globalDeferredPrompt;
    promptSubscribers.forEach((cb) => cb(globalDeferredPrompt));
  });
  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    window.__pwaDeferredPrompt = null;
    promptSubscribers.forEach((cb) => cb(null));
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => globalDeferredPrompt || readWindowDeferredPrompt()
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => detectStandalone());
  const [isIOS, setIsIOS] = useState<boolean>(() => detectPlatformFlags().isIOS);
  const [isAndroid, setIsAndroid] = useState<boolean>(() => detectPlatformFlags().isAndroid);
  const [isInAppBrowser, setIsInAppBrowser] = useState<boolean>(
    () => detectPlatformFlags().isInAppBrowser
  );

  useEffect(() => {
    const checkStandalone = () => {
      setIsInstalled(detectStandalone());
    };

    checkStandalone();
    const flags = detectPlatformFlags();
    setIsIOS(flags.isIOS);
    setIsAndroid(flags.isAndroid);
    setIsInAppBrowser(flags.isInAppBrowser);

    const earlyPrompt = globalDeferredPrompt || readWindowDeferredPrompt();
    if (earlyPrompt) {
      globalDeferredPrompt = earlyPrompt;
      setDeferredPrompt(earlyPrompt);
    }

    const handlePromptUpdate = (prompt: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(prompt);
    };
    promptSubscribers.add(handlePromptUpdate);

    const handleAppInstalled = () => {
      setIsInstalled(true);
      globalDeferredPrompt = null;
      window.__pwaDeferredPrompt = null;
      setDeferredPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    const mediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : null;
    if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', checkStandalone);
    }

    return () => {
      promptSubscribers.delete(handlePromptUpdate);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (mediaQuery && typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', checkStandalone);
      }
    };
  }, []);

  const install = async () => {
    const activePrompt = deferredPrompt || globalDeferredPrompt || readWindowDeferredPrompt();
    if (!activePrompt) return false;
    await activePrompt.prompt();
    const { outcome } = await activePrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      globalDeferredPrompt = null;
      window.__pwaDeferredPrompt = null;
      setDeferredPrompt(null);
      promptSubscribers.forEach((cb) => cb(null));
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!(deferredPrompt || globalDeferredPrompt || readWindowDeferredPrompt()),
    isInstalled,
    isIOS,
    isAndroid,
    isInAppBrowser,
    install,
  };
}
