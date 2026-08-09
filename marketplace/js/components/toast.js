/**
 * Toast — animated toast notification component
 */
const Toast = {
  _show(message, type, duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    // Trigger CSS transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('toast-visible'));
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  },

  success(msg, duration)  { this._show(msg, 'success', duration); },
  error(msg, duration)    { this._show(msg, 'error', duration); },
  info(msg, duration)     { this._show(msg, 'info', duration); },
  warning(msg, duration)  { this._show(msg, 'warning', duration); }
};
