/**
 * Auth — authentication logic (login, register, session)
 */
const Auth = {

  login(phone, role) {
    const user = Store.getUserByPhone(phone, role);
    if (!user) return { success: false, message: 'No account found with this phone number. Please register.' };

    Store.setCurrentUser(user);
    return { success: true, user };
  },

  register({ name, phone, role, location }) {
    // Check uniqueness
    if (Store.getUserByPhone(phone, role)) {
      return { success: false, message: 'This phone number is already registered. Please login instead.' };
    }

    const user = Store.addUser({ name, phone, role, location });
    Store.setCurrentUser(user);
    return { success: true, user };
  },

  logout() {
    Store.clearCurrentUser();
  },

  getCurrentUser() {
    return Store.getCurrentUser();
  },

  isLoggedIn() {
    return !!Store.getCurrentUser();
  }
};
