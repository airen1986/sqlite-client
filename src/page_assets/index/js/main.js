import * as bootstrap from 'bootstrap/dist/js/bootstrap.bundle.min.js';
window.bootstrap = bootstrap;
import '../../../scss/styles.scss';

import { init } from '../../../common/js/scl-app';

async function registerCoiServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.crossOriginIsolated) return;

  try {
    await navigator.serviceWorker.register('/sw-coi.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!window.crossOriginIsolated) {
      window.location.reload();
    }
  } catch {
    // Ignore registration failures; app can still run without SW header shim.
  }
}

// Start the app
registerCoiServiceWorker();
init();
