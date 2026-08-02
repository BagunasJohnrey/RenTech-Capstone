// Application-wide constants. Moved out of App.jsx for SoC.

export const ROLES = {
  ADMIN: 'Admin',
  STAFF: 'Staff',
  CUSTOMER: 'Customer',
};

export const NAV_ITEMS = {
  Admin: [
    { id: 'Dashboard', icon: 'LayoutGrid', label: 'Dashboard' },
    { id: 'Catalog', icon: 'ShoppingBag', label: 'Inventory' },
    { id: 'History', icon: 'Clock', label: 'Transactions' },
    { id: 'AI Insights', icon: 'Sparkles', label: 'AI Intelligence', special: true },
    { id: 'Settings', icon: 'Settings', label: 'Settings' },
  ],
  Staff: [
    { id: 'Dashboard', icon: 'LayoutGrid', label: 'Dashboard' },
    { id: 'Tasks', icon: 'ClipboardList', label: 'Tasks' },
    { id: 'Catalog', icon: 'ShoppingBag', label: 'Catalog' },
    { id: 'History', icon: 'Clock', label: 'Logs & Returns' },
    { id: 'Settings', icon: 'Settings', label: 'Settings' },
  ],
  Customer: [
    { id: 'Home', icon: 'LayoutGrid', label: 'Home' },
    { id: 'Catalog', icon: 'ShoppingBag', label: 'Collection' },
    { id: 'History', icon: 'Clock', label: 'Transactions' },
    { id: 'Profile', icon: 'User', label: 'Profile' },
    { id: 'Help', icon: 'User', label: 'Help Guide' },
  ],
};

export const ONBOARDING_KEYS = {
  Customer: 'onboardingDone_Customer',
  default: 'onboardingDone',
};
