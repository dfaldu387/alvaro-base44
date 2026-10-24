import React from 'react';

// Button with built-in loading state. Disables + shows spinner while
// processing, prevents duplicate clicks, restores on failure.
// Caller controls `loading` state.
export default function LoadingButton({
  children,
  loading = false,
  loadingText,
  disabled,
  onClick,
  className = '',
  variant = 'primary',
  type = 'button',
  ...rest
}) {
  const base =
    variant === 'primary'
      ? 'bg-gradient-to-r from-[#7c2bd6] to-[#9b4ef0] text-white shadow-[0_8px_24px_rgba(139,61,255,0.35)]'
      : 'bg-secondary border border-border text-foreground';
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading}
      className={`w-full h-12 rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${base} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      {...rest}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}