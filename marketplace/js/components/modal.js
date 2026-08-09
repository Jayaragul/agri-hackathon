/**
 * Modal — bottom sheet modal component
 */
const Modal = {
  _current: null,

  /**
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.content  Raw HTML string
   * @param {Array}  opts.actions  [{ label, class, onclick }]
   * @param {Function} opts.onClose
   */
  show({ title = '', content = '', actions = [], onClose = null } = {}) {
    this.close();

    const container = document.getElementById('modal-container');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const actionsHtml = actions.map(a =>
      `<button class="btn ${a.class || 'btn-secondary'} btn-full" onclick="${a.onclick}">${a.label}</button>`
    ).join('');

    overlay.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        ${title ? `<div class="modal-title">${title}</div>` : ''}
        <div class="modal-content">${content}</div>
        ${actionsHtml ? `<div class="modal-actions">${actionsHtml}</div>` : ''}
      </div>
    `;

    // Close on backdrop click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        this.close();
        if (onClose) onClose();
      }
    });

    container.appendChild(overlay);
    this._current = overlay;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('modal-visible'));
    });
  },

  close() {
    if (!this._current) return;
    this._current.classList.remove('modal-visible');
    const el = this._current;
    setTimeout(() => el.remove(), 350);
    this._current = null;
  }
};
