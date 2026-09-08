import { useState, useCallback } from 'react';
import { api } from '../utils/api';

// Manages staff accounts (Admin only): load, add, edit, remove.
export function useStaff() {
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [staffLoadError, setStaffLoadError] = useState(null);

  const loadStaff = useCallback(async () => {
    try {
      const data = await api.get('/auth/staff');
      setStaffAccounts(Array.isArray(data) ? data : []);
      setStaffLoadError(null);
    } catch (err) {
      setStaffAccounts([]);
      // Keep the failure so the Team tab can explain an empty list (e.g. a
      // 403 MFA challenge on the admin session) instead of "No staff yet".
      setStaffLoadError(err?.status === 403 ? err : null);
    }
  }, []);

  const addStaff = useCallback(async (newStaff) => {
    // The backend mints a one-time password for the new staff account and
    // returns it once — no password is ever typed by the admin.
    const created = await api.post('/auth/staff', {
      email: newStaff.email,
      name: newStaff.name || newStaff.username,
    });
    setStaffAccounts((prev) => {
      const { oneTimePassword: _otp, ...profile } = created;
      return [profile, ...prev];
    });
    return created;
  }, []);

  const removeStaff = useCallback(async (id) => {
    await api.delete(`/auth/staff/${id}`);
    setStaffAccounts((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Edit a staff account's display details (name/phone). Admin-only from the
  // Team tab; the backend also allows the staff member to edit their own.
  const updateStaff = useCallback(async (id, patch) => {
    const updated = await api.put(`/auth/staff/${id}`, patch);
    setStaffAccounts((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    return updated;
  }, []);

  return { staffAccounts, setStaffAccounts, staffLoadError, loadStaff, addStaff, removeStaff, updateStaff };
}
