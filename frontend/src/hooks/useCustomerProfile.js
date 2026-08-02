import { useState, useCallback } from 'react';

// Manages the editable customer profile (settings) and its sync with auth profile.
export function useCustomerProfile(updateProfile) {
  const [customerInfo, setCustomerInfo] = useState({ name: '', contact: '', address: '', preferences: [] });

  const parsePreferences = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value) return value.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  };

  const syncFromProfile = useCallback((profile) => {
    if (!profile) return;
    setCustomerInfo({
      name: profile.name || '',
      contact: profile.phone || '',
      address: profile.address || '',
      preferences: parsePreferences(profile.preferences),
    });
  }, []);

  // FIX D: surface the profile-save failure instead of an unhandled rejection
  // that silently leaves stale UI state.
  const updateCustomer = useCallback(async (data) => {
    setCustomerInfo(data);
    try {
      await updateProfile({
        name: data.name,
        phone: data.contact,
        address: data.address,
        preferences: data.preferences || [],
      });
    } catch (err) {
      console.error('Profile update failed:', err);
      alert(err?.message || 'Failed to save profile changes.');
      throw err;
    }
  }, [updateProfile]);

  return { customerInfo, setCustomerInfo, syncFromProfile, updateCustomer };
}
