import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

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
