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
    const created = await api.post('/auth/staff', {
      email: newStaff.email,
      password: newStaff.password,
      name: newStaff.name || newStaff.username,
    });
    setStaffAccounts((prev) => [created, ...prev]);
    return created;
  }, []);

  const removeStaff = useCallback(async (id) => {
    await api.delete(`/auth/staff/${id}`);
    setStaffAccounts((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { staffAccounts, setStaffAccounts, loadStaff, addStaff, removeStaff };
}
