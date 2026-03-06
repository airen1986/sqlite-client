/**
 * Tiny DOM helper utilities.
 *
 * Usage:
 *   import { $, $$, on } from '@/common/js/dom';
 *   const btn = $('#submit-btn');
 *   on(btn, 'click', () => console.log('clicked'));
 */

/** querySelector shorthand */
export const $ = (selector, scope = document) => scope.querySelector(selector);

/** querySelectorAll shorthand — returns a real Array */
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** Attach an event listener */
export function on(el, event, handler, options) {
  el.addEventListener(event, handler, options);
}

/** Remove an event listener */
export function off(el, event, handler, options) {
  el.removeEventListener(event, handler, options);
}

/** Wait for the DOM to be ready */
export function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}
