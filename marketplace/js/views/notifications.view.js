/**
 * NotificationsView — notification bell list + mark-read
 */
const NotificationsView = {

  show() {
    const user = Store.getCurrentUser();
    if (!user) return;

    Navbar.render(user.role, 'notifications');

    // Mark all as read
    Store.markAllRead(user.id);
    NotificationSystem.updateBadge();

    const notifs = Store.getNotificationsForUser(user.id);

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="page">
        <div class="page-title">Notifications 🔔</div>

        ${notifs.length === 0
          ? `<div class="empty-state">
               <div class="empty-state-icon">🔔</div>
               <div class="empty-state-title">All caught up!</div>
               <div class="empty-state-msg">You have no notifications. Activity on your orders will appear here.</div>
             </div>`
          : `<div style="border-radius:var(--radius-lg);overflow:hidden;border:1.5px solid var(--border-light);">
               ${notifs.map(n => this._renderNotif(n, user)).join('')}
             </div>`
        }
      </div>
    `;
  },

  _renderNotif(notif, user) {
    const icon = NotificationSystem.typeIcon(notif.type);
    const time = NotificationSystem.timeAgo(notif.createdAt);

    return `
      <div class="notif-item ${notif.read ? '' : 'unread'}"
           onclick="NotificationsView._openNotif('${notif.id}', '${notif.orderId || ''}')">
        <div class="notif-icon-wrap ${notif.type}">${icon}</div>
        <div class="notif-body">
          <div class="notif-msg">${notif.message}</div>
          <div class="notif-time">${time}</div>
        </div>
        ${!notif.read ? '<div class="notif-unread-dot"></div>' : ''}
      </div>
    `;
  },

  _openNotif(notifId, orderId) {
    if (orderId && orderId !== 'null' && orderId !== '') {
      OrdersView.showDetail(orderId);
    }
  }
};
