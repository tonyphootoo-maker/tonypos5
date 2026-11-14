import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Register Service Worker for Android/iOS Tablet & POS offline support and auto-updates
registerSW({ immediate: true });

// Remove initial bootstrap message once React mounts
const bootMsg = document.getElementById('boot-msg');
if (bootMsg) {
  bootMsg.remove();
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
