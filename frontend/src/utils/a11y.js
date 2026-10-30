// Keyboard support for clickable rows that can't be a real <button> because
// they contain their own buttons (SMS, Release, …). Spread onto the row:
//   <div {...rowActivation(open)} className={`… ${ROW_FOCUS}`}>
// Enter/Space only fire when the row itself has focus, so pressing Enter on
// a nested button never also opens the row.
export function rowActivation(onActivate) {
  if (!onActivate) return {};
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

export const ROW_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50';
