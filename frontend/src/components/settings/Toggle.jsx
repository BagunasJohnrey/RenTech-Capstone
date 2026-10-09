export default function Toggle({ on, onClick, className = '', label }) {
  return (
    <button onClick={onClick} aria-pressed={on} aria-label={label}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-[#bf4a53]' : 'bg-gray-300'} ${className}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}