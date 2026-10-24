import React from 'react';

// Dark-themed compact switch. Track: 44px × 24px. Thumb: 20px.
export default function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1] focus-visible:ring-offset-1 focus-visible:ring-offset-[#1a1a1e] ${checked ? 'bg-[#6366f1]' : 'bg-zinc-700'} disabled:opacity-50`}
      style={{ width: 44, height: 24 }}
    >
      <span
        className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform"
        style={{ width: 20, height: 20, left: 2, transform: checked ? 'translateX(20px) translateY(-50%)' : 'translateY(-50%)' }}
      />
    </button>
  );
}