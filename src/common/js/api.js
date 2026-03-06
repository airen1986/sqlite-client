/**
 * Lightweight API client built on top of fetch.
 *
 * Uses VITE_API_BASE_URL from the environment to prefix all requests.
 *
 * Usage:
 *   import api from '@/common/js/api';
 *   const data = await api.get('/users');
 *   await api.post('/users', { name: 'Jane' });
 */

import Swal from 'sweetalert2';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Show a Bootstrap-themed error confirm box via SweetAlert2.
 * Uses btn-danger for confirm and btn-outline-secondary for cancel.
 */
function showErrorDialog(title, message) {
  return Swal.fire({
    icon: 'error',
    title,
    text: message,
    confirmButtonText: 'Dismiss',
    customClass: {
      confirmButton: 'btn btn-danger',
    },
    buttonsStyling: false,
  });
}

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkError) {
    await showErrorDialog(
      'Network Error',
      'Unable to reach the server. Please check your connection.'
    );
    throw networkError;
  }

  if (!response.ok) {
    const error = new Error(`API error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    try {
      error.data = await response.json();
    } catch {
      // response body is not JSON — ignore
    }
    const message =
      error.data?.message ||
      error.data?.detail ||
      `Error ${response.status}: ${response.statusText}`;

    await showErrorDialog('Request Failed', message);
    throw error;
  }

  // 204 No Content
  if (response.status === 204) return null;

  return response.json();
}

const api = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: 'GET' }),

  post: (endpoint, body, options = {}) =>
    request(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),

  put: (endpoint, body, options = {}) =>
    request(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),

  patch: (endpoint, body, options = {}) =>
    request(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),

  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: 'DELETE' }),
};

export default api;
