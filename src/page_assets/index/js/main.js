import * as bootstrap from 'bootstrap/dist/js/bootstrap.bundle.min.js';
window.bootstrap = bootstrap;
import '../../../scss/styles.scss';

import { toastSuccess, toastError, toastWarning, toastInfo, confirm } from '../../../common/js/toast';
import { bsToastSuccess, bsToastError, bsToastWarning, bsToastInfo } from '../../../common/js/bsToast';
import { $, on } from '../../../common/js/dom';

// SweetAlert2 toast demo buttons
on($('#btn-toast-success'), 'click', () => toastSuccess('Operation completed!'));
on($('#btn-toast-error'), 'click', () => toastError('Something went wrong.'));
on($('#btn-toast-warning'), 'click', () => toastWarning('Please double-check your input.'));
on($('#btn-toast-info'), 'click', () => toastInfo('Here is some useful info.'));

// Confirm dialog demo
on($('#btn-confirm'), 'click', async () => {
  const result = await confirm('Are you sure?', 'This action cannot be undone.');
  if (result.isConfirmed) {
    toastSuccess('Confirmed!');
  }
});

// Bootstrap toast demo buttons
on($('#btn-bs-toast-success'), 'click', () => bsToastSuccess('Operation completed!'));
on($('#btn-bs-toast-error'), 'click', () => bsToastError('Something went wrong.'));
on($('#btn-bs-toast-warning'), 'click', () => bsToastWarning('Please double-check your input.'));
on($('#btn-bs-toast-info'), 'click', () => bsToastInfo('Here is some useful info.'));
