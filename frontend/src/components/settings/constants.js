export const ITEM_TYPES = ['Gown', 'Suit', 'Barong', 'Filipiniana', 'Costume'];

export const LS_BUSINESS = 'rental_business_profile';
export const LS_POLICIES = 'rental_policies';
export const LS_AUTOMATION = 'rental_automation';
export const LS_NOTIF = 'rental_notif_prefs';
export const LS_SIZES = 'rentech_pref_sizes';

export function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export const DEFAULT_BUSINESS = { name: 'RenTech Boutique', address: '', contact: '', taxId: '' };
export const DEFAULT_POLICIES = { defaultDays: 3, returnAfterEvent: 1, minDown: 200, damageFee: 1000 };
export const DEFAULT_AUTOMATION = { escalationDays: 3, retentionMonths: 12 };
export const DEFAULT_NOTIF = { booking: true, reminder: true, lateReturn: true, email: true };