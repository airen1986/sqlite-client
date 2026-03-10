/**
 * Toast notification helpers powered by SweetAlert2.
 *
 * Usage:
 *   import { toastSuccess, toastError, toastInfo } from '@/common/js/toast';
 *   toastSuccess('Saved successfully');
 *   toastError('Something went wrong');
 */

import Swal from 'sweetalert2';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 1000,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer);
    toast.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

export function toastSuccess(message) {
  return Toast.fire({ icon: 'success', title: message });
}

export function toastError(message) {
  return Toast.fire({ icon: 'error', title: message });
}

export function toastWarning(message) {
  return Toast.fire({ icon: 'warning', title: message });
}

export function toastInfo(message) {
  return Toast.fire({ icon: 'info', title: message });
}

/**
 * Show a confirmation dialog. Returns the SweetAlert2 result.
 *
 * Usage:
 *   const result = await confirm('Delete item?', 'This cannot be undone.');
 *   if (result.isConfirmed) { ... }
 */
export function confirm(title, text = '', confirmButtonText = 'Confirm') {
  return Swal.fire({
    title,
    text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText,
  });
}
