import { useState, useCallback } from 'react';
import { api } from '../utils/api';

// Manages staff accounts (Admin only): load, add, remove.
export function useStaff() {
  const [staffAccounts, setStaffAccounts] = useState([]);

  const loadStaff = useCallback(async () => {
    try {
      const data = await api.get('/auth/staff');
      setStaffAccounts(Array.isArray(data) ? data : []);
    } catch {
      setStaffAccounts([]);
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

  return { staffAccounts, setStaffAccounts, loadStaff, addStaff, removeStaff };
}
