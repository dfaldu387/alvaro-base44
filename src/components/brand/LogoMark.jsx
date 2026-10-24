import React from 'react';

export const LOGO_URL = 'https://media.base44.com/images/public/6a30d1ec9fcbb579c10f4d91/0f0c98cdd_logo.png';

// The Cut Deluxe logo, shown as a small rounded mark.
export default function LogoMark({ className = 'h-8 w-8' }) {
  return (
    <img
      src={LOGO_URL}
      alt="Cut Deluxe logo"
      className={`${className} shrink-0 rounded-lg object-contain`}
    />
  );
}