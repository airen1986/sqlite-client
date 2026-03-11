/*
  Best-effort COI shim: adds missing COOP/COEP/CORP headers to same-origin GET responses.
  Note: This only applies after the service worker controls the page.
*/

const REQUIRED_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only patch same-origin GET requests we can safely proxy.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      let networkResponse;
      try {
        networkResponse = await fetch(request);
      } catch (error) {
        // If the network request fails (e.g. offline), just return the error response.
        return new Response(error.message, { status: 503, statusText: 'Service Unavailable' });
      }

      // Do not attempt to rewrite opaque or redirected responses.
      if (networkResponse.type === 'opaque' || networkResponse.type === 'opaqueredirect') {
        return networkResponse;
      }

      const headers = new self.Headers(networkResponse.headers);
      Object.entries(REQUIRED_HEADERS).forEach(([name, value]) => {
        if (!headers.has(name)) {
          headers.set(name, value);
        }
      });

      return new self.Response(networkResponse.body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers,
      });
    })()
  );
});
