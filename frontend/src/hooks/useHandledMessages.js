import { useState } from 'react';

const LS_KEY = 'rentech_msg_handled';

// Handled (done) state per customer message, persisted locally so it
// survives reloads. Shared by the Messages inbox and the Notifications page
// so both show the same Done badges.
export function useHandledMessages() {
  const [handled, setHandled] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
    } catch {
      return new Set();
    }
  });

  const markHandled = (id, done) => {
    setHandled((prev) => {
      const next = new Set(prev);
      if (done) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      } catch { /* private mode */ }
      return next;
    });
  };

  return { handled, markHandled };
}
